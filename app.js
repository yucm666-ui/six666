
// ======================== 应用版本号（单一数据源） ========================
// 界面右上角与浏览器标签会显示此版本，方便平板上核对是否吃到了最新缓存。
// 升级功能时改这一处即可，无需改别处。
const APP_VERSION = '1.0.2';
function applyVersion() {
  document.title = '工作歌单 v' + APP_VERSION;
  const el = document.getElementById('appVersion');
  if (el) el.textContent = 'v' + APP_VERSION;
}

// ======================== 304首歌曲数据 ========================
let songs = [];


let progMap = {};

// ======================== 转调和弦映射 ========================
// 12个调的1-7级顺阶和弦（1=I主, 2=ii, 3=iii, 4=IV下属, 5=V属, 6=vi关系小调, 7=vii°减和弦）
const keyChords = {
  'C':  ['C','Dm','Em','F','G','Am','Bdim'],
  'Db': ['Db','Ebm','Fm','Gb','Ab','Bbm','Cdim'],
  'D':  ['D','Em','F#m','G','A','Bm','C#dim'],
  'Eb': ['Eb','Fm','Gm','Ab','Bb','Cm','Ddim'],
  'E':  ['E','F#m','G#m','A','B','C#m','D#dim'],
  'F':  ['F','Gm','Am','Bb','C','Dm','Edim'],
  'Gb': ['Gb','Abm','Bbm','Cb','Db','Ebm','Fdim'],
  'G':  ['G','Am','Bm','C','D','Em','F#dim'],
  'Ab': ['Ab','Bbm','Cm','Db','Eb','Fm','Gdim'],
  'A':  ['A','Bm','C#m','D','E','F#m','G#dim'],
  'Bb': ['Bb','Cm','Dm','Eb','F','Gm','Adim'],
  'B':  ['B','C#m','D#m','E','F#','G#m','A#dim']
};

let transposeKey = 'C'; // 当前选中的调（始终为12个调之一，不再有"原调"空值）
let currentOrigKey = null; // 当前展开歌曲的原调（用于标注"(原调)"），null=未展开任何歌曲

// 小调歌曲→关系大调映射（级数本就按关系大调标注，如Am调歌曲的"6"=Am=C大调的vi）
const minorToMajor = {'Am':'C','Bm':'D','Em':'G','F#m':'A','C#m':'E','G#m':'B','Dm':'F','Cm':'Eb','Fm':'Ab','Bbm':'Db','Abm':'Gb','Ebm':'B'};
// 取某首歌用于和弦转换的有效调（始终用transposeKey，因为不再有"原调"模式）
function effectiveChordKey(songKey) {
  return transposeKey;
}

// 半音表（偏b记法，更符合流行吉他谱习惯）
const chromaticNotes = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
// 和弦根音写法归一化（兼容 Db/C#、Bb/A# 等不同记谱习惯）
const NOTE_NORM = {
  'C':0,'B#':0,
  'C#':1,'Db':1,
  'D':2,'C##':2,
  'Eb':3,'D#':3,
  'E':4,'Fb':4,
  'F':5,'E#':5,
  'F#':6,'Gb':6,
  'G':7,
  'Ab':8,'G#':8,
  'A':9,
  'Bb':10,'A#':10,
  'B':11,'Cb':11
};
// 大调音阶各级相对1级的半音数
const degreeSemitones = {1:0, 2:2, 3:4, 4:5, 5:7, 6:9, 7:11};

// 合并基础和弦名与suffix修饰符（处理 sus4/maj7/m7/M/°/+ 等重叠）
// 性质遵循现代爵士/流行乐理论标准：maj=大三/大七，m=小三/小七，裸 7/9/13=属和弦（大三+b7），
// °=减，+=增；dom 为旧式属和弦写法（保留兼容），M 为旧式大三标记（保留兼容）。
function mergeSuffix(baseChord, suffix) {
  if (!suffix) return baseChord;
  let b = baseChord, s = suffix;
  const stripQuality = (x) => x.replace(/dim$/, '').replace(/min$/, '').replace(/aug$/, '').replace(/m$/, '');
  // 大三/大七：M 或 maj 开头
  if (s.startsWith('M') || s.startsWith('maj')) {
    b = stripQuality(b);
    if (s === 'M' || s === 'maj') s = '';
  }
  // 属七/九/十三：dom 开头，或裸 7/9/13（大三 + b7）
  if (s.startsWith('dom') || /^7/.test(s) || /^9/.test(s) || /^13/.test(s)) {
    b = stripQuality(b);
    if (s.startsWith('dom')) s = s.slice(3);
  }
  // dom 切完可能剩 M/maj（如 4domM → 4M），再按大三处理
  if (s === 'M' || s === 'maj') { b = stripQuality(b); s = ''; }
  // 小三/小七：m 开头（非 maj）→ 先剥掉已有性质(减/小/增)，再统一加 m，
  // 避免 F#dim + m7 → F#dim7（应得 F#m7）、F#dim + m → F#dimm（应得 F#m）
  if (s.startsWith('m') && !s.startsWith('maj')) {
    b = b.replace(/(dim|min|aug|m)$/, '');
    b = b + 'm';
  }
  // 减：° 或 dim
  if (s.startsWith('°') || s.startsWith('dim')) {
    b = stripQuality(b);
    s = s.replace(/^dim/, '°');
  }
  // 增：+ 或 aug
  if (s.startsWith('+') || s.startsWith('aug')) {
    b = stripQuality(b);
    s = s.replace(/^aug/, '+');
  }
  // 基础和弦尾 'm' 与 suffix 首 'm' 去重
  if (b.endsWith('m') && s.startsWith('m')) s = s.slice(1);
  return b + s;
}

// 把级数走向拆成小节数组 [{num:'1-5', chord:'C-G'}, ...]
// 支持 | 分隔自定义小节；无 | 则按拍号分子 N 每 N 个符号（=N 拍）为一小节（纯顺序定位）
function parseMeasures(str, chordStr, beats) {
  if (beats == null) beats = 4;
  if (!str) return [];
  if (str.includes('|')) {
    const numMs = str.split('|');
    const chordMs = chordStr ? chordStr.split('|') : [];
    return numMs.map((m, i) => ({ num: m, chord: chordMs[i] || '' }));
  }
  // 无 | ：1 符号 = 1 拍，每 N 拍（拍号分子）为一小节
  const numTokens = str.split('-');
  const chordTokens = chordStr ? chordStr.split('-') : [];
  const measures = [];
  for (let i = 0; i < numTokens.length; i += beats) {
    measures.push({
      num: numTokens.slice(i, i + beats).join('-'),
      chord: chordTokens.slice(i, i + beats).join('-')
    });
  }
  return measures;
}

// 取拍号分子（如 3/4 -> 3），缺省 4
function numeratorOf(timeSig) {
  const m = String(timeSig || '4/4').match(/(\d+)\s*\/\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 4;
}

// 把一段和弦字母拆成符号数组（每个符号=1拍）。
// 规则：'-' 即为一个休止拍；相邻字母按和弦边界切分（如 CG->C,G；DmEm->Dm,Em；C/G 保持整体）。
function splitChordTokens(str) {
  const re = /[A-G][#b]*(?:sus\d*|maj\d*|min|dim|aug|add\d*|[mM]\d*|\+|\°\d*|\d+)*(?:\/[A-G][#b]*)?/g;
  const s = String(str == null ? '' : str);
  const out = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '-') { out.push('-'); i++; continue; }   // 休止拍
    re.lastIndex = i;
    const m = re.exec(s);
    if (m && m.index === i && m[0]) { out.push(m[0]); i = re.lastIndex; }
    else { i++; }   // 跳过非和弦字符（空格、N.C. 等）
  }
  return out;
}

// 把级数串里的字母低音（如 5/E 的 E）换算成相对原调的级数低音（如 5/7），使级数行与和弦行结构一致
function letterBassToDegree(letter, origKey) {
  const target = NOTE_NORM[letter];
  if (target === undefined) return letter;
  // 小调原调级数按关系大调标注，用关系大调的顺阶和弦表换算
  const chords = keyChords[origKey] || keyChords[minorToMajor[origKey]];
  if (!chords) return letter;
  for (let d = 1; d <= 7; d++) {
    const m = chords[d - 1].match(/^([A-G][#b]*)/); // 直接取根音，规避 dim/m 后缀干扰
    const r = m ? m[1] : '';
    if ((NOTE_NORM[r] % 12) === (target % 12)) return String(d);
  }
  return letter; // 不在自然音阶内的变化低音，保持原字母
}
function bassLetterToDegreeStr(numToken, origKey) {
  if (!numToken) return numToken;
  const si = numToken.indexOf('/');
  if (si < 0) return numToken;
  const main = numToken.slice(0, si);
  const bass = numToken.slice(si + 1);
  if (!/^[A-G][#b]*$/.test(bass)) return numToken; // 已是数字低音（如 5/7）则不动
  return main + '/' + letterBassToDegree(bass, origKey);
}

// 渲染一个小节内 N 个拍格（N=拍号分子）。
// 落拍规则：和弦数 >= 拍数时顺序占位（每拍一个，与原行为一致）；
// 和弦数 < 拍数时按"均匀分布"定位——和弦 j 落在 floor(j * beats / k) 拍，
// 例如 4/4 两个和弦落在第1、3拍（而非顺序的第1、2拍），符合和弦谱惯例。
// 级数(numStr)与和弦(chordStr)按各自符号顺序一一对应，再映射到落拍位置。
// ignoreDeg=true 时隐藏"级数行"（.measure-num），复杂升降调歌曲只看和弦字母，避免级数换算显示混乱
function measureCellsHtml(numStr, chordStr, beats, origKey, ignoreDeg) {
  const nums = String(numStr == null ? '' : numStr).split('-').map(s => s.trim());
  // 字母串用 splitChordTokens 切分：'-' 是休止符（自身即一个符号），需保留为休止而非分隔符
  const chords = splitChordTokens(chordStr).map(s => s === '-' ? '' : s.trim());
  // 级数行：把字母低音（如 5/E 的 E）按原调换算成级数低音（5/7），使级数行与和弦行结构一致
  const numDegs = nums.map(n => bassLetterToDegreeStr(n, origKey));
  const k = chords.length;
  const useEven = k > 0 && k < beats;                 // 和弦少于拍数 → 均匀分布
  const posOf = (j) => useEven ? Math.floor(j * beats / k) : j;
  const beatToIdx = {};                               // 落拍位置 -> 和弦序号
  for (let j = 0; j < k; j++) {
    if (!chords[j]) continue;                         // 休止（'-'）不参与落拍映射
    const p = posOf(j);
    if (beatToIdx[p] === undefined) beatToIdx[p] = j; // 同拍取首个和弦
  }
  let html = '';
  for (let i = 0; i < beats; i++) {
    const j = (beatToIdx[i] !== undefined) ? beatToIdx[i] : -1;
    const c = j >= 0 ? chords[j] : '';                // 该拍无和弦 → 休止
    const nRaw = (c && j >= 0 && j < numDegs.length) ? numDegs[j] : '';  // 休止拍不显示级数
    // 级数后缀（sus/maj/min/dim/aug/add 等）用小字；转位 /X 不缩小
    const nHtml = nRaw ? nRaw.replace(/^([b#]?\d)((?:sus\d*|maj\d*|min|dim|aug|add\d*|[mM]\d*|\+|\°|\d+)?)(\/\d+)?$/,
      (_, root, suffix, slash) => root + (suffix ? '<small>' + suffix + '</small>' : '') + (slash || '')) : '';
    // 和弦字母行同步：转位 /X 不缩小；后缀与度数正则一致（含 [mM]\d*，避免大七 M7 被截断成 M）
    // 大七显示为标准写法：M7→maj7（如 GbM7→Gbmaj7、CM7→Cmaj7），小七 m7 / 属七 7 / maj7 不受影响
    const chordHtml = c ? c.replace(/^([A-G][#b]*)((?:sus\d*|maj\d*|min|dim|aug|add\d*|[mM]\d*|\+|\°\d*|\d+)*)(\/[A-G][#b]*)?$/,
      (_, root, suffix, slash) => {
        const disp = suffix ? suffix.replace(/^M(?=\d)/, 'maj') : '';
        return root + (disp ? '<small>' + disp + '</small>' : '') + (slash || '');
      }) : '';
    html += '<div class="beat' + (c ? ' has-chord' : ' rest') + (ignoreDeg ? ' no-num' : '') + '">'
      + (nHtml && !ignoreDeg ? '<div class="measure-num">' + nHtml + '</div>' : '')
      + '<div class="measure-chord' + (c ? '' : ' rest-mark') + '">' + (c ? chordHtml : '-') + '</div>'
      + '</div>';
  }
  return html;
}

// 单个级数token转字母和弦名
// origKey：歌曲原调（存储度数所属调）；转调时字母低音需按（目标调-原调）半音数整体移动
function convertToken(token, chords, keyIdx, origKey) {
  // 处理转位标记 5/7 → G/B
  const slashIdx = token.indexOf('/');
  let mainPart = token, bassPart = '';
  if (slashIdx >= 0) {
    mainPart = token.slice(0, slashIdx);
    bassPart = token.slice(slashIdx); // '/7'
    // bass部分的数字也做级数→字母转换
    const bm = bassPart.slice(1).match(/^([b#]?)(\d)(.*)$/);
    if (bm) {
      const bAcc = bm[1], bNum = parseInt(bm[2]), bSuffix = bm[3];
      if (bNum >= 1 && bNum <= 7) {
        let bassNote;
        if (!bAcc) {
          const bm2 = chords[bNum - 1].match(/^([A-G][#b]*)/); // 直接取根音，规避 dim/m 后缀干扰
          bassNote = bm2 ? bm2[1] : '';
        } else if (keyIdx >= 0) {
          let bs = degreeSemitones[bNum];
          if (bAcc === 'b') bs -= 1; else if (bAcc === '#') bs += 1;
          bassNote = chromaticNotes[(keyIdx + bs + 12) % 12];
        }
        if (bassNote) bassPart = '/' + bassNote + bSuffix;
      }
    } else {
      // 字母低音（如 /E）：绝对音名，需随转调按（目标调-原调）半音数整体移动，保持转位关系
      const bassLetter = bassPart.slice(1);
      if (/^[A-G][#b]*$/.test(bassLetter)) {
        const eIdx = chromaticNotes.indexOf(bassLetter);
        // 小调原调（Am 等）级数按关系大调标注，取关系大调半音索引
        const origIdx = (origKey != null && NOTE_NORM[origKey] != null) ? NOTE_NORM[origKey]
          : ((origKey != null && minorToMajor[origKey] != null) ? NOTE_NORM[minorToMajor[origKey]] : -1);
        if (eIdx >= 0 && origIdx >= 0) {
          const newIdx = (eIdx + (keyIdx - origIdx) + 120) % 12;
          bassPart = '/' + chromaticNotes[newIdx];
        }
      }
    }
  }
  // 休止符：'r' 或空 token 在度数串中代表空拍
  if (token === 'r' || token === '') return '-';
  // 主部分转换
  const m = mainPart.match(/^([b#]?)(\d)(.*)$/);
  if (!m) return token;
  const acc = m[1], num = parseInt(m[2]), suffix = m[3];
  if (num < 1 || num > 7) return token;
  if (!acc) return mergeSuffix(chords[num - 1], suffix) + bassPart;
  if (keyIdx < 0) return token;
  let semitone = degreeSemitones[num];
  if (acc === 'b') semitone -= 1; else if (acc === '#') semitone += 1;
  return mergeSuffix(chromaticNotes[(keyIdx + semitone + 12) % 12], suffix) + bassPart;
}

// 数字级数转字母和弦名
// 支持 | 小节分隔、b7/#4 变化级数、sus4/maj7/m7/M 修饰、5/7 与 5/E 转位
// origKey：歌曲原调；省略时等于 key（不转调），字母低音保持原样
function numToChord(progStr, key, origKey) {
  if (!progStr || !key) return '';
  const chords = keyChords[key];
  if (!chords) return '';
  const keyIdx = (NOTE_NORM[key] != null) ? NOTE_NORM[key] : -1;
  const oKey = (origKey != null) ? origKey : key;
  // 按 | 分段处理小节；小节内每个符号（和弦或休止 '-'）占一拍，直接拼接（休止即一个 '-'）
  return progStr.split('|').map(section => {
    return section.split('-').map(token => convertToken(token, chords, keyIdx, oKey)).join('');
  }).join('|');
}

// ======================== 字母和弦 → 数字级数（编辑模式反向推导） ========================
// 把单个字母和弦（如 C / Am / G7 / F#m / C/G / Bdim）反向映射为相对某调的数字级数。
// 优先用已有的 convertToken/numToChord 作为"真值"去做匹配搜索，确保正反向完全一致。
function letterToDegree(token, key) {
  token = (token || '').trim();
  if (!token) return '';
  if (token === '-' || token === 'r') return '';  // 休止符不参与级数推导
  const keyIdx = (NOTE_NORM[key] != null) ? NOTE_NORM[key] : -1;
  const chords = keyChords[key];
  if (!chords) return token;
  const m = token.match(/^([A-G][#b]*)(.*)$/);
  if (!m) return token; // 非法和弦（如 N.C.）原样返回，不参与推导
  const root = m[1];
  const rest = m[2];
  if (NOTE_NORM[root] === undefined) return token;
  const rootPC = NOTE_NORM[root] % 12; // 根音音级（用于等音比较，兼容 Db/C# 不同记谱）
  // 拆分 bass（转位）与 quality（和弦性质）
  let bass = '', quality = rest;
  const bi = rest.indexOf('/');
  if (bi >= 0) { bass = rest.slice(bi); quality = rest.slice(0, bi); }
  // 新标准写法优先（maj/°/+），旧式 M/dom 仅作兜底兼容，确保编辑模式产出标准度数
  const qCands = ['', quality, 'maj', '°7', 'm7b5'];
  // 1) 先试自然音级：直接用 keyChords 根音（兼容 Db/Eb/Ab 等降号调的正确拼法）
  for (let d = 1; d <= 7; d++) {
    const rRoot = chords[d - 1].replace(/dim$/, '').replace(/min$/, '').replace(/aug$/, '').replace(/m$/, ''); // 取该级顺阶根音（先剥 dim/min/aug 再剥 m）
    if ((NOTE_NORM[rRoot] % 12) !== rootPC) continue;
    // 第7级(导音)的小七/半减七/减小七 → 大调自然音阶里就是半减七 vii°7，标准记法统一为 7°7（避免 domm7 类畸形记号）
    if (d === 7 && /m7|b5|°/.test(quality)) return '7°7' + bass;
    for (const q of qCands) {
      const test = d + q + bass;
      if (numToChord(test, key) === token) return String(d) + (q || '') + bass;
    }
  }
  // 2) 再试变化音级（b/#）：依赖半音表（降号调的转位/变化音为已知边界，仅升号调可用）
  if (keyIdx >= 0) {
    for (const acc of ['b', '#']) {
      for (let d = 1; d <= 7; d++) {
        const sem = degreeSemitones[d] + (acc === 'b' ? -1 : 1);
        const r = chromaticNotes[(keyIdx + sem + 120) % 12];
        if ((NOTE_NORM[r] % 12) !== rootPC) continue;
        if (d === 7 && /m7|b5|°/.test(quality)) return acc + '7°7' + bass;
        for (const q of qCands) {
          const test = acc + d + q + bass;
          if (numToChord(test, key) === token) return acc + d + (q || '') + bass;
        }
      }
    }
  }
  return token; // 无法识别则原样保留
}

// 将整段字母和弦字符串（按 | 分段）反向推导为数字级数串（纯顺序：每个符号=1拍）。
// 空符号（休止）保留为标记 'r'，确保往返不丢休止。和弦切分用 splitChordTokens（兼容 CG/C-G 两种写法）。
function deriveDegrees(str, key) {
  if (!str) return '';
  return str.split('|').map(section => {
    const toks = splitChordTokens(section);
    return toks.map(t => t === '-' ? 'r' : letterToDegree(t, key)).join('-');
  }).join('|');
}

// 从全部字母和弦中识别最可能的调（12 个大调之一）。
// 评分：自然音级权重高于变化音级，平局时优先 preferKey（通常为歌曲原调的关系大调）。
function detectKeyFromLetters(str, preferKey) {
  const tokens = str.split(/[\s|]+/).map(t => t.trim()).filter(Boolean)
    .flatMap(t => splitChordTokens(t))
    .filter(t => t && t !== '-');   // 跳过休止符 '-'
  if (!tokens.length) return null;
  let bestKey = null, bestScore = -1;
  for (const key of Object.keys(keyChords)) {
    let nat = 0, alt = 0;
    for (const tk of tokens) {
      const deg = letterToDegree(tk, key);
      if (deg && !/[A-Ga-g]/.test(deg)) { // 已成功解析为级数（不含字母）
        if (/[#b]/.test(deg)) alt++; else nat++;
      }
    }
    const score = nat * 2 + alt;
    if (score > bestScore || (score === bestScore && key === preferKey)) {
      bestScore = score; bestKey = key;
    }
  }
  return bestScore > 0 ? bestKey : null;
}

// 选中某个调的按钮（高亮）
function selectKeyButton(key) {
  document.querySelectorAll('.key-btn').forEach(b => b.classList.remove('active'));
  const target = document.querySelector('.key-btn[data-key="' + key + '"]');
  if (target) target.classList.add('active');
}


// 清除搜索
function clearSearch() {
  const input = document.getElementById('search');
  input.value = '';
  searchTerm = '';
  document.getElementById('searchClear').classList.remove('visible');
  render();
  input.focus();
}

// 回到顶部
function backToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== 临时歌单管理 =====
// 添加到临时歌单
function addToTemp(id) {
  if (!tempList.includes(id)) {
    tempList.push(id);
    render();
    // 切到临时歌单Tab，让用户看到添加效果
    if (currentTab !== 'temp') {
      // 在工作歌单里：按钮已通过render变成✓状态
      // 闪烁临时歌单Tab提示
      const tabTemp = document.getElementById('tab-temp');
      tabTemp.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(1.15)', backgroundColor: 'rgba(88,166,255,0.25)' },
        { transform: 'scale(1)' }
      ], { duration: 350, easing: 'ease-out' });
    }
  }
}
// 从临时歌单移除
function removeFromTemp(id) {
  const idx = tempList.indexOf(id);
  if (idx >= 0) {
    tempList.splice(idx, 1);
    render();
  }
}

// 切换和弦对照表面板展开/收起
function toggleRefPanel() {
  const panel = document.getElementById('refPanel');
  panel.classList.toggle('open');
  // 展开/收起后 toolbar 高度变化，重新计算 thead sticky top
  setTimeout(updateStickyTop, 260);
}

// 渲染和弦对照表（锁定行内的面板）
// refEditMode 开启时：每个和弦进行模块变为可编辑卡片（改名/改级数、拖动排序、删除），并可新增模块。
let refEditMode = false;
const refUidMap = new Map();
let _refUid = 0;
function refModuleUid(pr) {
  let u = refUidMap.get(pr);
  if (u == null) { u = ++_refUid; refUidMap.set(pr, u); }
  return u;
}
function renderRefPanel() {
  const body = document.getElementById('refPanelBody');
  if (!body) return;
  const refSong = songs.find(s => s.pinned && s.progs);
  if (!refSong || !refSong.progs) return;
  const key = effectiveChordKey(refSong.key);
  if (!refEditMode) {
    // 普通模式：只读网格
    const html = refSong.progs.map(pr => {
      const val = pr.p || '';
      const chordStr = numToChord(val, key, refSong.key);
      const beats = numeratorOf(refSong.timeSig);
      const measures = parseMeasures(val, chordStr, beats);
      const cells = measures.map(m =>
        '<div class="measure">' + measureCellsHtml(m.num, m.chord, beats, refSong.key, refSong.ignoreDegrees) + '</div>'
      ).join('');
      return '<div class="prog-section"><span class="prog-label">' + escAttr(pr.n) + '</span><div class="prog-measures">' + cells + '</div></div>';
    }).join('');
    body.innerHTML = html;
    fitMeasureWidths(body);
    updateRefEditBtn();
    return;
  }
  // 编辑模式：可编辑卡片
  const html = refSong.progs.map(pr => {
    const uid = refModuleUid(pr);
    const val = pr.p || '';
    const chordStr = numToChord(val, key, refSong.key);
    const preview = val ? chordStr : '';
    return '<div class="prog-section ref-edit" data-prog-uid="' + uid + '" draggable="false" ondragover="refDragOver(event)" ondragleave="refDragLeave(event)" ondrop="refDragDrop(event)">' +
      '<div class="sec-edit-head">' +
        '<span class="section-drag" title="拖动排序" draggable="true" ondragstart="refDragStart(event,' + uid + ')" ondragend="refDragEnd(event)">≡</span>' +
        '<button class="section-del" title="删除该进行" onclick="refRemoveProg(' + uid + ')">✕</button>' +
        '<input class="section-label-input" id="reflabel-' + uid + '" value="' + escAttr(pr.n) + '" placeholder="进行名称" oninput="refSetName(' + uid + ',this.value)" />' +
      '</div>' +
      '<textarea class="edit-chords ref-prog-chords" id="refedit-' + uid + '" rows="1" oninput="autoGrow(this);refSetProg(' + uid + ',this.value)">' + escAttr(val) + '</textarea>' +
      '<div class="ref-preview" id="refprev-' + uid + '">' + escAttr(preview) + '</div>' +
    '</div>';
  }).join('');
  body.innerHTML = html + '<div class="add-section ref-add"><button class="btn outline" onclick="refAddProg()">＋ 添加和弦进行</button></div>';
  body.querySelectorAll('.ref-prog-chords').forEach(el => autoGrow(el));
  updateRefEditBtn();
}

// ======================== 和弦对照表编辑模式控制 ========================
function toggleRefEditMode(e) {
  if (e) e.stopPropagation();
  refEditMode = !refEditMode;
  renderRefPanel();
}
function updateRefEditBtn() {
  const b = document.getElementById('refEditBtn');
  const hint = document.getElementById('refEditHint');
  if (!b) return;
  if (refEditMode) {
    b.className = 'ref-edit-btn active';
    b.textContent = '✓ 完成';
    if (hint) hint.textContent = '拖动 ≡ 排序 · 点 ＋ 新增 · 改名/改级数后自动保存';
  } else {
    b.className = 'ref-edit-btn';
    b.textContent = '✏️ 编辑';
    if (hint) hint.textContent = '';
  }
}
// 编辑时写回数据（不触发整面板重渲染，保留输入焦点）
function refFind(uid) {
  const s = songs.find(x => x.pinned && x.progs);
  return s ? s.progs.find(p => refModuleUid(p) === uid) : null;
}
function refSetName(uid, v) {
  const p = refFind(uid);
  if (p) p.n = v;
}
function refSetProg(uid, v) {
  const p = refFind(uid);
  if (!p) return;
  p.p = v;
  const prev = document.getElementById('refprev-' + uid);
  if (prev) {
    const s = songs.find(x => x.pinned && x.progs);
    if (s) prev.textContent = v ? numToChord(v, effectiveChordKey(s.key), s.key) : '';
  }
}
function refAddProg() {
  const s = songs.find(x => x.pinned && x.progs);
  if (!s) return;
  const pr = { n: '新进行', p: '' };
  s.progs.push(pr);
  renderRefPanel();
  const inp = document.getElementById('reflabel-' + refModuleUid(pr));
  if (inp) inp.focus();
}
function refRemoveProg(uid) {
  const s = songs.find(x => x.pinned && x.progs);
  if (!s) return;
  s.progs = s.progs.filter(p => refModuleUid(p) !== uid);
  renderRefPanel();
}
// ---- 模块拖拽排序 ----
let refDragSrcUid = null;
function refDragStart(e, uid) {
  refDragSrcUid = uid;
  const el = e.target.closest('.prog-section');
  if (el) { el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
}
function refDragEnd(e) {
  const el = e.target.closest('.prog-section');
  if (el) el.classList.remove('dragging');
  document.querySelectorAll('.prog-section.drag-over').forEach(s => s.classList.remove('drag-over'));
  refDragSrcUid = null;
}
function refDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.currentTarget;
  if (String(target.dataset.progUid) !== String(refDragSrcUid)) target.classList.add('drag-over');
}
function refDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}
function refDragDrop(e) {
  e.preventDefault();
  const target = e.currentTarget;
  target.classList.remove('drag-over');
  if (refDragSrcUid == null) return;
  const body = document.getElementById('refPanelBody');
  if (!body) return;
  const srcEl = body.querySelector('.prog-section[data-prog-uid="' + refDragSrcUid + '"]');
  const dstEl = target;
  if (!srcEl || srcEl === dstEl) return;
  const children = Array.from(body.querySelectorAll('.prog-section.ref-edit'));
  const srcI = children.indexOf(srcEl), dstI = children.indexOf(dstEl);
  if (srcI < dstI) body.insertBefore(srcEl, dstEl.nextElementSibling);
  else body.insertBefore(srcEl, dstEl);
  // 依据拖拽后的 DOM 顺序，重排 progs 数组（用稳定 uid 映射回对象）
  const newUids = Array.from(body.querySelectorAll('.prog-section.ref-edit')).map(el => parseInt(el.dataset.progUid, 10));
  const s = songs.find(x => x.pinned && x.progs);
  if (s) {
    const byUid = new Map();
    s.progs.forEach(p => byUid.set(refModuleUid(p), p));
    s.progs = newUids.map(u => byUid.get(u));
  }
}

const sectionNames = {i:'前奏 Intro', v:'主歌 Verse', p:'预副歌 Pre-Chorus', c:'副歌 Chorus', b:'桥段 Bridge', s1:'间奏 Solo 1', s2:'间奏 Solo 2', s3:'间奏 Solo 3', out:'尾奏 Outro'};
const sectionOrder = ['i','v','p','c','s1','s2','b','s3','out'];

// ======================== 弹奏备注（按段落独立存储）========================
// 读取某首歌某段落的备注
// 段落备注：内存存储（当前会话有效，刷新即清空，回到初始空备注）
const _sectionNotes = {"229_i":"SOLO","229_v":"分解","230_out":"X4","230_s2":"X2","230_v":"第二遍最后多一小节G","228_out":"4个间奏和弦一样，间奏2要*3","305_b":"过渡段含 Fm、Gsus4（离调和弦，丰富色彩）"};
function getSectionNote(id, section) {
  return _sectionNotes[id + '_' + section] || '';
}
// 保存某首歌某段落的备注（仅内存，不持久化）
function saveSectionNote(id, section, val) {
  _sectionNotes[id + '_' + section] = val;
}
// 歌词：按小节存储（measureIdx 从 0 开始），独立于备注，内存存储
const _sectionLyrics = {};
function getSectionLyrics(id, section, measureIdx) {
  return _sectionLyrics[id + '_' + section + '_' + measureIdx] || '';
}
function saveSectionLyrics(id, section, measureIdx, val) {
  const key = id + '_' + section + '_' + measureIdx;
  // 与备注(saveSectionNotes)一致：清空时保留键并置空，而非 delete。
  // 否则 saveToGitHub 的合并仅遍历 _sectionLyrics 现存键，被删的键不会被清掉，
  // 导致"网页里删了歌词、保存后 GitHub 上还在"。
  _sectionLyrics[key] = (val == null) ? '' : val;
}
// 备注输入框自动撑高（无下拉条）
function autoGrow(el) {
  el.style.height = '28px';
  el.style.height = el.scrollHeight + 'px';
}

// 小节和弦"太挤被盖住"时，自动调宽当前小节（不再缩小字号）：
// 字体保持正常大小；只有某小节内和弦字母真实溢出（被裁/被盖）时，才把这一小节单独加宽，
// 其余小节等分会收缩让出空间（min-width 保底）。整体单行排列，不换行、不留空挡。
// 实现：小节为 flex 单行等宽；检测到某小节等宽分配下最宽一拍放不下时，
// 将该小节拍格改为按内容宽度排列并固定其宽度为内容所需宽（紧凑，不浪费空间），从而不裁剪。
function fitMeasureWidths(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('.prog-measures').forEach(pm => {
    const measures = Array.from(pm.querySelectorAll('.measure'));
    if (!measures.length) return;
    // 先清除上一轮加宽，恢复等分基准，再迭代检测（加宽会挤压邻格，需多次收敛）
    measures.forEach(m => {
      m.style.flex = ''; m.style.width = '';
      m.querySelectorAll('.beat').forEach(b => { b.style.flex = ''; });
    });
    for (let iter = 0; iter < 6; iter++) {
      let changed = false;
      measures.forEach(m => {
        if (m.dataset.wide === '1') return;            // 已加宽的小节跳过
        const beats = m.querySelectorAll('.beat');
        const n = beats.length || 1;
        let maxBeat = 0, sum = 0;
        beats.forEach(b => {
          const c = b.querySelector('.measure-chord');
          const cw = c ? c.scrollWidth : 0;            // nowrap 下反映真实内容宽（即使被 overflow:hidden 裁也能量到）
          const bcs = getComputedStyle(b);
          const w = cw + parseFloat(bcs.paddingLeft) + parseFloat(bcs.paddingRight);
          if (w > maxBeat) maxBeat = w;
          sum += w;
        });
        if (!maxBeat) return;
        const cs = getComputedStyle(m);
        const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        // 等宽拍格下不溢出所需最小小节宽 = 拍数 × 最宽拍；当前等宽格已满足则不处理
        const needEqual = maxBeat * n + padX + 2;
        if (needEqual <= m.clientWidth) return;
        // 溢出：加宽为内容所需宽，并让拍格按内容宽度排列（紧凑），确保无裁剪
        m.dataset.wide = '1';
        m.style.flex = '0 0 auto';
        m.style.width = Math.ceil(sum + padX + 2) + 'px';
        beats.forEach(b => { b.style.flex = '0 0 auto'; });
        changed = true;
      });
      if (!changed) break;
    }
    measures.forEach(m => { delete m.dataset.wide; });
  });
}

// 生成单个段落（前奏/主歌/副歌…或对照表条目）的和弦展示 HTML。
// editMode 为 true 且非置顶歌曲时，渲染为可直接编辑的字母和弦输入框；否则渲染数字级数+字母和弦网格。
function escAttr(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function getSectionName(s, k, def) {
  const nm = progMap[s.id] && progMap[s.id].nm;
  return (nm && nm[k]) ? nm[k] : def;
}
function sectionHtml(s, k, val, label, inEdit) {
  const isProg = typeof k === 'string' && k.indexOf('prog') === 0;
  const effLabel = getSectionName(s, k, label);
  const hasCustom = !!(progMap[s.id] && progMap[s.id].nm && progMap[s.id].nm[k]);
  // 普通模式：无和弦且无自定义名称则不渲染；编辑模式则始终渲染（便于改名/新增）
  if (!val && !hasCustom && !inEdit) return '';

  if (inEdit && !s.pinned) {
    // 编辑模式：模块名称可输入、和弦以字母形式可改；空模块也渲染以便新增/命名
    const baseKey = minorToMajor[s.key] || s.key;
    const letterStr = val ? numToChord(val, baseKey) : '';
    const editField = '<textarea class="edit-chords" id="edit-' + s.id + '-' + k + '" rows="1" oninput="autoGrow(this)">' + letterStr + '</textarea>';
    const nameField = '<input class="section-label-input" id="label-' + s.id + '-' + k + '" value="' + escAttr(effLabel) + '" placeholder="模块名称" />';
    const showDel = !isProg; // 固定与自定义模块均可删除（对照表 prog 已在 !s.pinned 处被排除）
    const delBtn = showDel ? '<button class="section-del" title="移除该模块" onclick="removeSection(' + s.id + ',\'' + k + '\')">✕</button>' : '';
    const dragHandle = '<span class="section-drag" title="拖动排序" draggable="true" ondragstart="dragSectionStart(event,' + s.id + ',\'' + k + '\')" ondragend="dragSectionEnd(event)">≡</span>';
    return '<div class="prog-section edit" data-sec-key="' + k + '" ondragover="dragSectionOver(event)" ondragleave="dragSectionLeave(event)" ondrop="dragSectionDrop(event,' + s.id + ')">' + dragHandle + '<div class="sec-edit-head">' + delBtn + nameField + '</div>' + editField + '</div>';
  }

  // 普通模式：数字级数 + 字母和弦网格（按拍号分子均分每小节）+ 每小节歌词
  const effKey = effectiveChordKey(s.key);
  const chordStr = val ? numToChord(val, effKey, s.key) : '';
  const beats = numeratorOf(s.timeSig);
  const measures = val ? parseMeasures(val, chordStr, beats) : [];
  const cells = measures.map((m, idx) => {
    const lyricsVal = getSectionLyrics(s.id, k, idx);
    return '<div class="measure">' +
      '<div class="measure-beats">' + measureCellsHtml(m.num, m.chord, beats, s.key, s.ignoreDegrees) + '</div>' +
      '<div class="measure-lyrics" onclick="event.stopPropagation()"><textarea class="lyrics-input" id="lyrics-' + s.id + '-' + k + '-' + idx + '" placeholder="歌词" oninput="autoGrow(this);saveSectionLyrics(' + s.id + ',\'' + k + '\',' + idx + ',this.value)" rows="1" cols="1">' + escAttr(lyricsVal) + '</textarea></div>' +
    '</div>';
  }).join('');
  const igTag = s.ignoreDegrees ? ' <span class="ig-tag" title="本歌已开启忽略级数：只看和弦字母">仅和弦</span>' : '';
  return '<div class="prog-section"><span class="prog-label">' + escAttr(effLabel) + igTag + '</span><div class="prog-measures">' + cells + '</div></div>';
}

// ======================== 渲染逻辑（升级版 v3 · 精简） ========================
let searchTerm = '';
let sortField = 'id';
let sortDir = 'asc';
let currentTab = 'main';
let editMode = false; // 编辑模式：开启后可直接修改字母和弦，保存时反向推导级数
let currentDetailId = null; // 当前展开详情的歌曲 id（每次仅一首）
const expandedSet = new Set();

// ---- 初始数据（无持久化：刷新网页即回到文件内置初始状态）----

// 临时歌单：文件初始内置 6 首（与静态 HTML 一致），编辑/拖拽仅存于内存
const INITIAL_TEMP = [229,227,228,230,231,304,305,306];
let tempList = INITIAL_TEMP.slice();

// progMap：直接使用文件内联初始数据，编辑/删除仅存于内存
// songs：直接使用文件内联初始数据，编辑仅存于内存

// ======================== 导出修改指令（供助手回填 HTML）========================
// 初始快照：在数据加载完成后通过 resetInitSnap() 拍照，导出时做 diff，只导出真正改动的部分。
const _initSnap = { tempList: [], songs: [], progMap: {}, notes: {}, lyrics: {} };
function resetInitSnap() {
  _initSnap.tempList = tempList.slice(); // 拍当前实际值（含远程加载的 tempList），否则导出永远误报临时歌单有改动
  _initSnap.songs = JSON.parse(JSON.stringify(songs));
  _initSnap.progMap = JSON.parse(JSON.stringify(progMap));
  _initSnap.notes = JSON.parse(JSON.stringify(_sectionNotes));
  _initSnap.lyrics = JSON.parse(JSON.stringify(_sectionLyrics));
}
const _eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 构建导出数据对象：仅包含相对初始状态发生变化的字段
function buildExportData() {
  const out = {
    _type: 'songbook-edit',
    _note: '由歌单.html导出。把本段JSON直接发给助手，即可将这些改动回填进HTML初始数据。',
    _exportedAt: new Date().toLocaleString('zh-CN', { hour12: false })
  };
  // 1) 临时歌单：改动则给出完整新数组（含顺序）
  if (!_eq(tempList, _initSnap.tempList)) out.tempList = tempList.slice();
  // 2) 歌曲元信息：仅改动的歌，给完整对象
  const initSongById = {};
  _initSnap.songs.forEach(s => { initSongById[s.id] = s; });
  const songDiff = {};
  songs.forEach(s => {
    const orig = initSongById[s.id];
    if (!orig || !_eq(orig, s)) songDiff[s.id] = s;
  });
  if (Object.keys(songDiff).length) out.songs = songDiff;
  // 3) 和弦进行/模块：仅改动的歌，给完整 progMap 条目（被清空的记为 null）
  const progDiff = {};
  const allProgIds = new Set([...Object.keys(progMap), ...Object.keys(_initSnap.progMap)]);
  allProgIds.forEach(id => {
    const a = progMap[id], b = _initSnap.progMap[id];
    if (!_eq(a, b)) progDiff[id] = (a === undefined ? null : a);
  });
  if (Object.keys(progDiff).length) out.progMap = progDiff;
  // 4) 段落备注：仅改动的键（key 形如 "歌曲id_模块key"）
  const noteDiff = {};
  const allNoteKeys = new Set([...Object.keys(_sectionNotes), ...Object.keys(_initSnap.notes)]);
  allNoteKeys.forEach(k => {
    const a = (_sectionNotes[k] || ''), b = (_initSnap.notes[k] || '');
    if (a !== b) noteDiff[k] = a;
  });
  if (Object.keys(noteDiff).length) out.sectionNotes = noteDiff;
  // 5) 小节歌词：仅改动的小节（key 形如 "歌曲id_模块key_小节序号"）
  const lyricsDiff = {};
  const allLyricsKeys = new Set([...Object.keys(_sectionLyrics), ...Object.keys(_initSnap.lyrics)]);
  allLyricsKeys.forEach(k => {
    const a = (_sectionLyrics[k] || ''), b = (_initSnap.lyrics[k] || '');
    if (a !== b) lyricsDiff[k] = a;
  });
  if (Object.keys(lyricsDiff).length) out.sectionLyrics = lyricsDiff;
  return out;
}

function _exportChangeCount(data) {
  return (data.tempList ? 1 : 0)
    + (data.songs ? Object.keys(data.songs).length : 0)
    + (data.progMap ? Object.keys(data.progMap).length : 0)
    + (data.sectionNotes ? Object.keys(data.sectionNotes).length : 0)
    + (data.sectionLyrics ? Object.keys(data.sectionLyrics).length : 0);
}

let _lastExportText = '';
function openExportModal() {
  const data = buildExportData();
  const n = _exportChangeCount(data);
  const hint = document.getElementById('exportHint');
  const ta = document.getElementById('exportTa');
  if (n === 0) {
    hint.innerHTML = '当前<b>没有检测到任何改动</b>（相对文件初始数据）。改动临时歌单 / 元信息 / 和弦 / 模块 / 备注后再导出。';
    _lastExportText = JSON.stringify(data, null, 2);
    ta.value = _lastExportText;
  } else {
    const parts = [];
    if (data.tempList) parts.push('临时歌单');
    if (data.songs) parts.push('元信息 ' + Object.keys(data.songs).length + ' 首');
    if (data.progMap) parts.push('和弦/模块 ' + Object.keys(data.progMap).length + ' 首');
    if (data.sectionNotes) parts.push('备注 ' + Object.keys(data.sectionNotes).length + ' 条');
    if (data.sectionLyrics) parts.push('歌词 ' + Object.keys(data.sectionLyrics).length + ' 小节');
    hint.innerHTML = '检测到改动：<b>' + parts.join(' · ') + '</b>。用下方按钮<b>复制</b>或<b>下载</b>，把这段 JSON 直接发给助手即可回填到文件。';
    _lastExportText = JSON.stringify(data, null, 2);
    ta.value = _lastExportText;
  }
  document.getElementById('exportMask').classList.add('open');
}
function closeExportModal() {
  document.getElementById('exportMask').classList.remove('open');
}
function copyExport() {
  const ta = document.getElementById('exportTa');
  const btn = document.getElementById('exportCopyBtn');
  const done = () => { btn.textContent = '✅ 已复制'; btn.classList.add('ok'); setTimeout(() => { btn.textContent = '📋 复制文本'; btn.classList.remove('ok'); }, 1600); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(_lastExportText).then(done).catch(() => { ta.focus(); ta.select(); document.execCommand('copy'); done(); });
  } else {
    ta.focus(); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { alert('复制失败，请手动全选文本框内容复制。'); }
  }
}
function downloadExport() {
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/[\/: ]/g, '-');
  const blob = new Blob([_lastExportText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = '歌单修改指令-' + stamp + '.txt';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ======================== 手动新增歌曲 ========================
// 数据流：songs.push → 导出 diff（songDiff 含 !orig 新歌）→ saveToGitHub 的 mergeSongs added 分支随 songs 一起保存
function openAddModal() {
  // 填充调性下拉：12 大调 + 12 小调（与曲库实际用法一致，小调按关系大调标注级数）
  const majors = Object.keys(keyChords);
  const minors = Object.keys(minorToMajor);
  const fill = (id, sel) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">—</option>' + majors.concat(minors)
      .map(k => '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + k + '</option>').join('');
  };
  fill('add-key', 'C'); fill('add-mk', ''); fill('add-fk', '');
  ['add-name', 'add-artist', 'add-bpm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const ts = document.getElementById('add-ts'); if (ts) ts.value = '4/4';
  const ig = document.getElementById('add-ignore'); if (ig) ig.checked = false;
  document.getElementById('addMask').classList.add('open');
  const n = document.getElementById('add-name');
  if (n) n.focus();
}
function closeAddModal() {
  document.getElementById('addMask').classList.remove('open');
}
function addSong() {
  const gv = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const name = gv('add-name');
  if (!name) { alert('请填写歌名'); return; }
  // id = 全库最大 id + 1（mergeSongs 的 added 分支凭新 id 识别为新增，随保存同步到 GitHub）
  const id = Math.max(0, ...songs.map(s => s.id || 0)) + 1;
  const song = {
    id: id,
    name: name,
    artist: gv('add-artist'),
    key: gv('add-key') || 'C',
    maleKey: gv('add-mk'),
    femaleKey: gv('add-fk'),
    bpm: gv('add-bpm'),
    timeSig: gv('add-ts') || '4/4',
    ignoreDegrees: (() => { const el = document.getElementById('add-ignore'); return !!(el && el.checked); })()
  };
  songs.push(song);
  closeAddModal();
  // 确保新歌可见：切回工作歌单 + 清空搜索
  if (currentTab !== 'main') {
    currentTab = 'main';
    document.getElementById('tab-main').classList.add('active');
    document.getElementById('tab-temp').classList.remove('active');
  }
  const si = document.getElementById('search');
  if (si) si.value = '';
  searchTerm = '';
  render();
  renderRefPanel();
  // 展开新歌详情并直接进入编辑模式，方便立刻录入和弦/歌词
  toggleProg(id);
  if (!editMode) toggleEditMode();
}

// ======================== 网页直接保存上传到 GitHub ========================
// 仓库信息：从 GitHub Pages URL 解析（owner.github.io/repo），失败回退硬编码
const REPO = (() => {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = (location.pathname.split('/')[1] || '').replace(/\/$/, '');
  if (m && repo) return m[1] + '/' + repo;
  return 'yucm666-ui/crispy-octo-eureka';
})();
const SONGS_API = 'https://api.github.com/repos/' + REPO + '/contents/songs.json';

// 页面加载时回填已记住的 token
(function () {
  const t = localStorage.getItem('gh_token');
  const inp = document.getElementById('ghToken');
  if (t && inp) inp.value = t;
})();

function utf8ToBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
function base64ToUtf8(str) { return decodeURIComponent(escape(atob(str))); }

function getGhToken() {
  const inp = document.getElementById('ghToken');
  return ((inp && inp.value) || '').trim() || (localStorage.getItem('gh_token') || '');
}

// 以远程为基底，仅应用本地"真正改过"的部分（避免本地旧值覆盖他人在远程的新修改，也避免覆盖他人新增的歌）
function mergeSongs(remote, mem) {
  const initStr = {};
  _initSnap.songs.forEach(s => { initStr[s.id] = JSON.stringify(s); });
  const byId = {};
  mem.forEach(s => { byId[s.id] = s; });
  // 同 id：本地改过才覆盖远程；没改过保留远程（他人可能更新过）
  const kept = remote.map(r => (byId[r.id] && JSON.stringify(byId[r.id]) !== initStr[r.id]) ? Object.assign({}, r, byId[r.id]) : r);
  // 本地有而远程没有的歌（如新增的置顶条目）：追加
  const added = mem.filter(m => !remote.find(r => r.id === m.id));
  return kept.concat(added);
}
function mergeProg(remote, mem) {
  const out = Object.assign({}, remote);
  // 仅本地改过的条目覆盖远程同 id 条目
  Object.keys(mem).forEach(k => { if (mem[k] !== undefined && !_eq(mem[k], _initSnap.progMap[k])) out[k] = mem[k]; });
  return out;
}

function saveToGitHub() {
  const token = getGhToken();
  const status = document.getElementById('ghSaveStatus');
  const btn = document.getElementById('ghSaveBtn');
  if (!token) { if (status) { status.textContent = '请先填入 GitHub Token'; status.style.color = '#f85149'; } return; }
  if (document.getElementById('ghRemember') && document.getElementById('ghRemember').checked) localStorage.setItem('gh_token', token);
  if (btn) btn.disabled = true;
  if (status) { status.textContent = '保存中…'; status.style.color = ''; }

  fetch(SONGS_API, { headers: { 'Authorization': 'token ' + token } })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(remote => {
      const remoteData = JSON.parse(base64ToUtf8(remote.content));
      // 合并备注：远程为基底，仅本地"真正改过"的键覆盖；空值视为删除
      const mergedNotes = Object.assign({}, remoteData.sectionNotes || {});
      Object.keys(_sectionNotes).forEach(k => {
        if ((_sectionNotes[k] || '') === (_initSnap.notes[k] || '')) return; // 未改动，不碰远程
        const v = (_sectionNotes[k] || '').trim();
        if (v) mergedNotes[k] = v;
        else delete mergedNotes[k];
      });
      // 合并歌词：远程为基底，仅本地"真正改过"的小节覆盖；空值视为删除
      const mergedLyrics = Object.assign({}, remoteData.sectionLyrics || {});
      Object.keys(_sectionLyrics).forEach(k => {
        if ((_sectionLyrics[k] || '') === (_initSnap.lyrics[k] || '')) return; // 未改动，不碰远程
        const v = (_sectionLyrics[k] || '').trim();
        if (v) mergedLyrics[k] = v;
        else delete mergedLyrics[k];
      });
      const merged = {
        songs: mergeSongs(remoteData.songs || [], songs),
        progMap: mergeProg(remoteData.progMap || {}, progMap),
        sectionNotes: mergedNotes,
        sectionLyrics: mergedLyrics,
        // 临时歌单：本地改过才覆盖远程，否则保留远程（他人可能更新过）
        tempList: (!_eq(tempList, _initSnap.tempList) || !Array.isArray(remoteData.tempList)) ? tempList.slice() : remoteData.tempList.slice()
      };
      return fetch(SONGS_API, {
        method: 'PUT',
        headers: { 'Authorization': 'token ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '更新歌单（网页保存）',
          content: utf8ToBase64(JSON.stringify(merged, null, 0)),
          sha: remote.sha
        })
      }).then(r2 => { if (!r2.ok) throw new Error('HTTP ' + r2.status); return r2.json(); }).then(() => merged);
    })
    .then(merged => {
      // 保存成功后直接用合并数据更新内存并重新渲染（无需刷新页面，绕过 CDN 缓存）
      songs = merged.songs;
      progMap = merged.progMap;
      // 同步临时歌单（本地没改时 merged 里是远程值，可能含他人更新）
      if (Array.isArray(merged.tempList)) tempList = merged.tempList.slice();
      // 同步备注：用合并后的 sectionNotes 更新内存
      Object.keys(_sectionNotes).forEach(k => { if (!(k in (merged.sectionNotes || {}))) delete _sectionNotes[k]; });
      Object.assign(_sectionNotes, merged.sectionNotes || {});
      // 同步歌词：用合并后的 sectionLyrics 更新内存
      Object.keys(_sectionLyrics).forEach(k => { if (!(k in (merged.sectionLyrics || {}))) delete _sectionLyrics[k]; });
      Object.assign(_sectionLyrics, merged.sectionLyrics || {});
      resetInitSnap();
      render();
      renderRefPanel();
      if (currentDetailId) renderDetail();
      if (status) { status.textContent = '✅ 已保存到 GitHub'; status.style.color = '#3fb950'; }
      if (btn) btn.disabled = false;
      setTimeout(() => { if (status) status.textContent = ''; }, 4000);
    })
    .catch(err => {
      if (btn) btn.disabled = false;
      let msg = '保存失败：' + err.message;
      if (/401|403/.test(err.message)) msg = 'Token 无效或无写权限';
      else if (/409/.test(err.message)) msg = '远程有更新，请刷新页面后重试';
      if (status) { status.textContent = msg; status.style.color = '#f85149'; }
    });
}

// 转调：固定初始选调 C（与 HTML 默认高亮一致），不持久化
transposeKey = 'C';
currentOrigKey = null;

const tbody = document.getElementById('tbody');

function keyClass(k) {
  const map = {
    'C':'key-C','G':'key-G','Am':'key-Am','D':'key-D','Em':'key-Em',
    'F':'key-F','Bm':'key-Bm','A':'key-A','E':'key-E','Dm':'key-Dm',
    'Db':'key-Db','Eb':'key-Eb','Ab':'key-Ab','Bb':'key-Bb',
    'Gb':'key-Gb','B':'key-B'
  };
  return map[k] || 'key-other';
}

function getFiltered() {
  let base = currentTab === 'temp'
    ? tempList.map(id => songs.find(s => s.id === id)).filter(Boolean)
    : songs.slice();
  if (searchTerm) {
    const t = searchTerm.toLowerCase();
    base = base.filter(s => s.name.toLowerCase().includes(t) || s.artist.toLowerCase().includes(t));
  }
  return base;
}

// 当前可见歌曲列表：过滤 + 排序（临时歌单保持人工顺序），并剔除置顶工具条目（只在"锁定行"面板显示）
function getVisibleList() {
  let list = getFiltered();
  if (currentTab !== 'temp') {
    list.sort((a, b) => {
      const ap = a.pinned ? 1 : 0, bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      let va = a[sortField], vb = b[sortField];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }
  return list.filter(s => !(s.pinned && s.progs));
}

function render() {
  const list = getVisibleList();

  document.getElementById('count-main').textContent = songs.filter(s => !s.pinned).length;
  document.getElementById('count-temp').textContent = tempList.length;

  if (currentTab === 'temp' && tempList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-temp"><div class="empty-icon">⭐</div><div class="empty-text">临时歌单还是空的</div><div class="empty-hint">到「工作歌单」点击歌曲右侧的 ＋ 即可加入演出清单</div></td></tr>';
    updateSortArrows();
    return;
  }
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">没有找到匹配的歌曲 😢</td></tr>';
    updateSortArrows();
    return;
  }

  tbody.innerHTML = list.map((s, i) => {
    const p = progMap[s.id] || {i:'',v:'',p:'',c:'',b:'',s1:'',s2:'',s3:'',out:''};
    const hasProg = p.i||p.v||p.p||p.c||p.b||p.s1||p.s2||p.s3||p.out||(s.progs&&s.progs.length);
    const pinnedCls = s.pinned ? ' pinned-row' : '';
    const pinnedTag = s.pinned ? '<span class="pinned-tag">置顶</span>' : '';
    const expanded = expandedSet.has(s.id);
    const orderNo = currentTab === 'temp' ? (i + 1) : s.id;
    let actionBtnHtml;
    if (currentTab === 'temp') {
      actionBtnHtml = '<button class="action-btn remove" title="移除" onclick="event.stopPropagation();removeFromTemp(' + s.id + ')">−</button>';
    } else {
      const added = tempList.includes(s.id);
      actionBtnHtml = added
        ? '<button class="action-btn added" title="已在清单" disabled>✓</button>'
        : '<button class="action-btn" title="加入清单" onclick="event.stopPropagation();addToTemp(' + s.id + ')">＋</button>';
    }
    const rowHtml = `
    <tr class="song-row${pinnedCls}" data-id="${s.id}" draggable="${currentTab==='temp'?'true':'false'}" onclick="toggleProg(${s.id})">
      <td class="col-id">${orderNo}</td>
      <td class="col-name">${escAttr(s.name)}${pinnedTag} ${hasProg ? '<span class="prog-toggle">' + (expanded ? '&#9660;' : '&#9654;') + '</span>' : ''}</td>
      <td class="col-artist">${escAttr(s.artist)}</td>
      <td class="col-key"><span class="key-badge ${keyClass(s.key)}">${s.key}</span></td>
      <td class="col-male">${s.maleKey || ''}</td>
      <td class="col-female">${s.femaleKey || ''}</td>
      <td class="col-bpm">${s.bpm ? '<span class="bpm-link" title="设为节拍器速度" onclick="event.stopPropagation();setMetroBpm(' + s.bpm + ')">' + s.bpm + '</span>' : ''}</td>
      <td class="col-timesig">${s.timeSig || ''}</td>
      <td class="col-action">${actionBtnHtml}</td>
    </tr>`;
    return rowHtml;
  }).join('');

  updateSortArrows();
  updateStickyTop();
  // 详情区打开时，随列表/转调/编辑等同步刷新
  if (currentDetailId) renderDetail();
}

function updateSortArrows() {
  document.querySelectorAll('thead th').forEach(th => {
    th.classList.remove('sorted');
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = '';
  });
  const ths = document.querySelectorAll('thead th');
  const fieldMap = ['id','name','artist','key','maleKey','femaleKey','bpm','timeSig'];
  const idx = fieldMap.indexOf(sortField);
  if (idx >= 0 && ths[idx]) {
    ths[idx].classList.add('sorted');
    ths[idx].querySelector('.sort-arrow').textContent = sortDir === 'asc' ? '▲' : '▼';
  }
}

function sortBy(field) {
  if (sortField === field) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
  else { sortField = field; sortDir = 'asc'; }
  render();
}

function navigateSong(dir) {
  // 在当前过滤+排序后的列表中找到上一首/下一首
  const list = getVisibleList();
  const idx = list.findIndex(s => s.id === currentDetailId);
  if (idx < 0) return;
  const nextIdx = idx + dir;
  if (nextIdx < 0 || nextIdx >= list.length) return;
  const nextSong = list[nextIdx];
  toggleProg(nextSong.id);
}
function toggleProg(id) {
  const song = songs.find(s => s.id === id);
  if (!song) return;
  // 已打开的再次点击 → 关闭回到列表
  if (currentDetailId === id) { closeDetail(); return; }
  // 每次只能展开一首：清空其它，仅展开当前
  currentDetailId = id;
  expandedSet.clear();
  expandedSet.add(id);
  const origKey = minorToMajor[song.key] || song.key;
  currentOrigKey = origKey;
  transposeKey = origKey;
  selectKeyButton(origKey);
  if (song.bpm) setMetroBpm(song.bpm);
  openDetail();
  renderRefPanel();
}
// 打开详情区：隐藏列表、显示铺满锁定行以下的全屏和弦页
function openDetail() {
  const song = songs.find(s => s.id === currentDetailId);
  if (!song) return;
  const dv = document.getElementById('detailView');
  const tw = document.querySelector('.table-wrap');
  if (tw) tw.style.display = 'none';
  // 计算"锁定行"底部作为详情区 top（tab-bar + toolbar + 和弦对照表面板）
  let top = 0;
  const tb = document.querySelector('.toolbar');
  if (tb) top = Math.max(top, tb.getBoundingClientRect().bottom);
  const rp = document.getElementById('refPanel');
  if (rp && rp.offsetHeight) top = Math.max(top, rp.getBoundingClientRect().bottom);
  dv.style.top = top + 'px';
  dv.classList.add('open');
  renderDetail();
  if (dv.scrollTo) dv.scrollTo({ top: 0 });
}
// 渲染详情区内容（复用 sectionHtml）
function renderDetail() {
  const id = currentDetailId;
  const song = songs.find(s => s.id === id);
  if (!song) return;
  const p = progMap[id] || {i:'',v:'',p:'',c:'',b:'',s1:'',s2:'',s3:'',out:''};
  const hasProg = p.i||p.v||p.p||p.c||p.b||p.s1||p.s2||p.s3||p.out||(song.progs&&song.progs.length);
  // 标题：歌名 + 右侧元信息（原调 / 男调 / 女调 / 速度 / 拍号）
  const titleEl = document.getElementById('detailTitle');
  if (editMode && !song.pinned) {
    // 编辑模式：元信息可输入
    const keyOpts = (sel) => '<option value="">—</option>' + Object.keys(keyChords).map(k => '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + k + '</option>').join('');
    let meta = '<span class="dm-edit"><label>原调</label><select id="meta-key-' + id + '">' + keyOpts(song.key) + '</select></span>';
    meta += '<span class="dm-edit"><label>男调</label><select id="meta-mk-' + id + '">' + keyOpts(song.maleKey) + '</select></span>';
    meta += '<span class="dm-edit"><label>女调</label><select id="meta-fk-' + id + '">' + keyOpts(song.femaleKey) + '</select></span>';
    meta += '<span class="dm-edit"><label>速度</label><input id="meta-bpm-' + id + '" type="text" value="' + escAttr(song.bpm || '') + '" placeholder="BPM" /></span>';
    meta += '<span class="dm-edit"><label>拍号</label><input id="meta-ts-' + id + '" type="text" value="' + escAttr(song.timeSig || '') + '" placeholder="4/4" /></span>';
    titleEl.innerHTML = '<span class="detail-name">' + escAttr(song.name) + '</span><span class="detail-meta edit-meta">' + meta + '</span>';
  } else {
    const chip = (label, val) => '<span class="dm-chip"><i>' + label + '</i><b>' + val + '</b></span>';
    let meta = chip('原调', song.key || '—');
    if (song.maleKey) meta += chip('男调', song.maleKey);
    if (song.femaleKey) meta += chip('女调', song.femaleKey);
    if (song.bpm) meta += chip('速度', song.bpm);
    if (song.timeSig) meta += chip('拍号', song.timeSig);
    titleEl.innerHTML = '<span class="detail-name">' + escAttr(song.name) + '</span><span class="detail-meta">' + meta + '</span>';
  }
  // 正文：各段落和弦（编辑模式下为可输入字母框 / 可改名 / 可新增模块）
  const bodyEl = document.getElementById('detailBody');
  const cur = progMap[id] || {};
  const customKeys = Object.keys(cur).filter(k => k !== 'nm' && k !== 'del' && k !== 'order' && sectionOrder.indexOf(k) < 0 && k.indexOf('prog') !== 0);
  const removed = (cur.del) || [];
  // 构建有序 key 列表：优先用自定义 order，否则用默认顺序
  let orderedKeys;
  if (cur.order && Array.isArray(cur.order)) {
    const validOrder = cur.order.filter(k => (sectionOrder.indexOf(k) >= 0 && removed.indexOf(k) < 0) || customKeys.indexOf(k) >= 0 || k.indexOf('prog') === 0);
    const remaining = sectionOrder.filter(k => removed.indexOf(k) < 0 && validOrder.indexOf(k) < 0);
    const remainingCustom = customKeys.filter(k => validOrder.indexOf(k) < 0);
    orderedKeys = validOrder.concat(remaining, remainingCustom);
  } else {
    orderedKeys = sectionOrder.filter(k => removed.indexOf(k) < 0).concat(customKeys);
  }
  // prog keys 始终排在最后
  const progKeys = (song.progs || []).map((_, idx) => 'prog' + idx);
  const nonProgKeys = orderedKeys.filter(k => k.indexOf('prog') !== 0);
  orderedKeys = nonProgKeys.concat(progKeys.filter(k => nonProgKeys.indexOf(k) < 0));
  let html = '<div class="prog-detail">';
  orderedKeys.forEach(k => {
    const isProg = k.indexOf('prog') === 0;
    html += sectionHtml(song, k, p[k] || '', isProg ? (song.progs && song.progs[parseInt(k.slice(4))] ? song.progs[parseInt(k.slice(4))].n : '') : (sectionNames[k] || '模块'), editMode);
  });
  html += (editMode && !song.pinned ? '<div class="add-section"><button class="btn outline" onclick="addSection(' + id + ')">＋ 添加模块</button></div>' : '');
  html += (!hasProg && customKeys.length === 0 ? '<span class="prog-empty">暂无和弦走向数据</span>' : '');
  html += '</div>';
  bodyEl.innerHTML = html;
  bodyEl.querySelectorAll('.lyrics-input').forEach(el => autoGrow(el));
  fitMeasureWidths(bodyEl);
  updateEditBtn();
  updateIgnoreBtn();
}
// 关闭详情区，回到歌曲列表；silent=true 时跳过重渲染（由调用方统一渲染，如 switchTab）
function closeDetail(silent) {
  const id = currentDetailId;
  const dv = document.getElementById('detailView');
  const tw = document.querySelector('.table-wrap');
  if (tw) tw.style.display = '';
  if (dv) { dv.classList.remove('open'); }
  currentDetailId = null;
  expandedSet.clear();
  editMode = false;
  updateEditBtn();
  if (silent) return;
  render();
  renderRefPanel();
  if (id != null) {
    const row = document.querySelector('.song-row[data-id="' + id + '"]');
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ======================== 编辑模式：保存 / 开关 ========================
function toggleEditMode() {
  editMode = !editMode;
  render();
  renderRefPanel();
  updateEditBtn();
}
// 切换"忽略级数模式"：开启后该歌只显示和弦字母、隐藏级数行。变更随下次"保存到 GitHub"持久化
// （buildExportData 的 songDiff 以整首歌对象做 diff，ignoreDegrees 字段自然包含在内）。
function toggleIgnoreDegrees(id) {
  const song = songs.find(s => s.id === id);
  if (!song) return;
  song.ignoreDegrees = !song.ignoreDegrees;
  renderDetail();
  renderRefPanel();
  updateIgnoreBtn();
}
function updateIgnoreBtn() {
  const b = document.getElementById('ignoreToggle');
  if (!b) return;
  const song = songs.find(s => s.id === currentDetailId);
  const on = !!(song && song.ignoreDegrees);
  b.textContent = on ? '🔕 已隐藏级数' : '🔢 显示级数';
  b.className = 'btn outline' + (on ? ' active' : '');
}
function updateEditBtn() {
  const b = document.getElementById('editToggle');
  const c = document.getElementById('editCancel');
  if (b) {
    if (editMode) {
      b.className = 'btn primary';
      b.textContent = '💾 暂存';
      b.onclick = () => saveChordEdit(currentDetailId);
    } else {
      b.className = 'btn outline';
      b.textContent = '✏️ 编辑';
      b.onclick = () => toggleEditMode();
    }
  }
  if (c) c.style.display = editMode ? '' : 'none';
}
// ======================== 模块拖拽排序 ========================
let dragSrcKey = null;
function dragSectionStart(e, id, k) {
  dragSrcKey = k;
  const el = e.target.closest('.prog-section');
  if (el) { el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', k); }
}
function dragSectionEnd(e) {
  const el = e.target.closest('.prog-section');
  if (el) el.classList.remove('dragging');
  document.querySelectorAll('.prog-section.drag-over').forEach(s => s.classList.remove('drag-over'));
  dragSrcKey = null;
}
function dragSectionOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.currentTarget;
  if (target.dataset.secKey !== dragSrcKey) target.classList.add('drag-over');
}
function dragSectionLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}
function dragSectionDrop(e, id) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget;
  target.classList.remove('drag-over');
  const srcKey = e.dataTransfer.getData('text/plain');
  const dstKey = target.dataset.secKey;
  if (!srcKey || srcKey === dstKey) return;
  const pd = document.querySelector('#detailBody .prog-detail');
  if (!pd) return;
  const srcEl = pd.querySelector('.prog-section[data-sec-key="' + srcKey + '"]');
  const dstEl = pd.querySelector('.prog-section[data-sec-key="' + dstKey + '"]');
  if (!srcEl || !dstEl) return;
  // 确定插入位置：若 src 在 dst 之前，插到 dst 之后；反之插到 dst 之前
  const children = Array.from(pd.children).filter(c => c.classList.contains('prog-section'));
  const srcIdx = children.indexOf(srcEl), dstIdx = children.indexOf(dstEl);
  if (srcIdx < dstIdx) {
    pd.insertBefore(srcEl, dstEl.nextElementSibling);
  } else {
    pd.insertBefore(srcEl, dstEl);
  }
  // 记录自定义排序到 progMap
  const pm = progMap[id] || (progMap[id] = {});
  const newOrder = Array.from(pd.querySelectorAll('.prog-section[data-sec-key]')).map(el => el.dataset.secKey);
  pm.order = newOrder;
}
// 新增一个空白自定义模块（不重建 DOM，保留其它段落的未保存编辑）
function addSection(id) {
  const pm = progMap[id] || (progMap[id] = {});
  let n = 0;
  while (('x' + n) in pm) n++;
  pm['x' + n] = '';
  if (!pm.nm) pm.nm = {};
  pm.nm['x' + n] = '新模块';
  const song = songs.find(s => s.id === id);
  const pd = document.querySelector('#detailBody .prog-detail');
  if (!pd) return;
  const addBtn = pd.querySelector('.add-section');
  const wrap = document.createElement('div');
  wrap.innerHTML = sectionHtml(song, 'x' + n, '', '模块', true);
  // 编辑模式下 sectionHtml 返回「模块区 + 备注区」两个并列节点，需全部插入（否则备注框丢失）
  Array.from(wrap.children).forEach(nd => pd.insertBefore(nd, addBtn));
  const inp = pd.querySelector('#label-' + id + '-x' + n);
  if (inp) inp.focus();
  const ta = pd.querySelector('#note-' + id + '-x' + n);
  if (ta) autoGrow(ta);
}
// 移除一个模块（自定义直接删 key；原有固定模块标记为已删除）
function removeSection(id, k) {
  const pm = progMap[id];
  if (!pm) return;
  if (sectionOrder.indexOf(k) < 0 && k.indexOf('prog') !== 0) {
    // 自定义模块：直接删除 key 与名称
    delete pm[k];
    if (pm.nm) delete pm.nm[k];
  } else {
    // 原有固定模块：标记删除（渲染时跳过），并清除其内容与自定义名
    if (!pm.del) pm.del = [];
    if (pm.del.indexOf(k) < 0) pm.del.push(k);
    delete pm[k];
    if (pm.nm) delete pm.nm[k];
  }
  const node = document.querySelector('#label-' + id + '-' + k);
  if (node) { const sec = node.closest('.prog-section'); if (sec) sec.remove(); }
}

// 保存某首歌的字母和弦编辑：反向推导级数并设定选调
function saveChordEdit(id) {
  const song = songs.find(s => s.id === id);
  if (!song) return;
  const cur = progMap[id] || {};
  const preferKey = minorToMajor[song.key] || song.key;
  const del = cur.del || [];
  // 读取编辑态下的元信息输入（原调 / 男调 / 女调 / 速度 / 拍号）
  const _mKeyEl = document.getElementById('meta-key-' + id);
  const _mMkEl = document.getElementById('meta-mk-' + id);
  const _mFkEl = document.getElementById('meta-fk-' + id);
  const _mBpmEl = document.getElementById('meta-bpm-' + id);
  const _mTsEl = document.getElementById('meta-ts-' + id);
  const _newOrigKey = (_mKeyEl && _mKeyEl.value) ? _mKeyEl.value : song.key;
  const _origKeyChanged = !!_mKeyEl && !!_mKeyEl.value && _mKeyEl.value !== song.key;
  // 按 DOM 中实际顺序收集 key（尊重拖拽排序结果）
  const pd = document.querySelector('#detailBody .prog-detail');
  let allKeys;
  if (pd) {
    allKeys = Array.from(pd.querySelectorAll('.prog-section[data-sec-key]')).map(el => el.dataset.secKey);
  } else {
    const fixedKeys = sectionOrder.filter(k => (cur[k] || '') !== '' || (cur.nm && cur.nm[k])).filter(k => del.indexOf(k) < 0);
    const customKeys = Object.keys(cur).filter(k => k !== 'nm' && k !== 'del' && k !== 'order' && sectionOrder.indexOf(k) < 0 && k.indexOf('prog') !== 0);
    const progKeys = (song.progs || []).map((_, i) => 'prog' + i);
    allKeys = fixedKeys.concat(customKeys, progKeys);
  }
  // 收集全部字母用于调性识别
  let combined = '';
  allKeys.forEach(k => {
    const ta = document.getElementById('edit-' + id + '-' + k);
    if (ta) combined += ' ' + ta.value.trim();
  });
  if (!combined.trim()) { // 无任何可推导内容：直接退出编辑
    editMode = false;
    updateEditBtn();
    render();
    return;
  }
  // 推导级数始终按和弦字母自动识别（平局优先原调）；原调仅作为“转调默认调”，不参与重定价
  const key = detectKeyFromLetters(combined, preferKey);
  if (!key) {
    alert('无法识别调性，请检查输入的和弦名称是否正确（如 C、Am、G7、F#m、C/G 等）。');
    return;
  }
  const newProg = {};
  const nm = {};
  allKeys.forEach(k => {
    const ta = document.getElementById('edit-' + id + '-' + k);
    const letterStr = ta ? ta.value.trim() : (cur[k] || '');
    newProg[k] = letterStr ? deriveDegrees(letterStr, key) : ''; // 空模块（仅命名）也保留为空串
    const lab = document.getElementById('label-' + id + '-' + k);
    const labVal = lab ? lab.value.trim() : getSectionName(song, k, '');
    const def = (k.indexOf('prog') === 0) ? '' : (sectionNames[k] || '模块');
    if (k.indexOf('prog') !== 0 && labVal && labVal !== def) nm[k] = labVal;
  });
  if (Object.keys(nm).length) newProg.nm = nm;
  if (del.length) newProg.del = del;
  // 持久化拖拽排序（仅当顺序与默认不同时记录）
  const defaultOrder = sectionOrder.filter(k => (cur[k] || '') !== '' || (cur.nm && cur.nm[k])).filter(k => del.indexOf(k) < 0)
    .concat(Object.keys(cur).filter(k => k !== 'nm' && k !== 'del' && k !== 'order' && sectionOrder.indexOf(k) < 0 && k.indexOf('prog') !== 0));
  const currentOrder = allKeys.filter(k => k.indexOf('prog') !== 0);
  if (JSON.stringify(currentOrder) !== JSON.stringify(defaultOrder)) {
    newProg.order = currentOrder;
  }
  progMap[id] = newProg;
  // 元信息编辑结果（原调 / 男调 / 女调 / 速度 / 拍号）仅存于内存
  if (_mKeyEl && _mKeyEl.value) song.key = _mKeyEl.value;
  if (_mMkEl && _mMkEl.value) song.maleKey = _mMkEl.value;
  if (_mFkEl && _mFkEl.value) song.femaleKey = _mFkEl.value;
  if (_mBpmEl) song.bpm = _mBpmEl.value.trim();
  if (_mTsEl) song.timeSig = _mTsEl.value.trim();
  // 原调即“转调默认调”：仅当用户改动过原调时，默认选调落到新原调（只改默认值，不重定价级数）；
  // 否则沿用推导出的实际调，保持显示与输入一致
  transposeKey = _origKeyChanged ? _newOrigKey : key;
  selectKeyButton(transposeKey);
  currentOrigKey = _newOrigKey;
  editMode = false;
  updateEditBtn();
  render();
  renderRefPanel();
}

// 切换选调（无持久化，刷新即回到初始选调）
function changeTransposeKey(key, btnEl) {
  transposeKey = key;
  selectKeyButton(key);
  render();
  renderRefPanel();
}

// 覆盖原 switchTab：切换时清空展开状态
function switchTab(tab) {
  closeDetail(true);
  if (currentTab === tab) { render(); renderRefPanel(); return; }
  currentTab = tab;
  expandedSet.clear();
  document.getElementById('tab-main').classList.toggle('active', tab === 'main');
  document.getElementById('tab-temp').classList.toggle('active', tab === 'temp');
  const input = document.getElementById('search');
  input.value = '';
  searchTerm = '';
  document.getElementById('searchClear').classList.remove('visible');
  render();
  renderRefPanel();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStickyTop() {
  const tb = document.querySelector('.toolbar');
  if (tb) {
    const h = tb.offsetHeight;
    document.querySelectorAll('thead th').forEach(th => th.style.top = h + 'px');
  }
}

// ======================== 节拍器（Web Audio · 拍号自由输入） ========================
let metroCtx = null, metroTimer = null, metroOn = false, metroBpm = 80, beatCount = 0;
let meterNum = 4, meterDen = 4;
let nextNoteTime = 0;           // 下一拍的 AudioContext 时钟时刻
const METRO_LOOKAHEAD = 0.12;   // 声音提前排程窗口（秒）
const METRO_INTERVAL = 25;      // 调度器唤醒间隔（毫秒）
let metroVol = 100;   // 音量百分比（20–300），乘到各拍增益上；>200 会硬削波（舞台更响但略失真）
function ensureCtx() { if (!metroCtx) metroCtx = new (window.AudioContext || window.webkitAudioContext)(); }
// 在 AudioContext 时钟的 t 时刻精确发声（而非立即发声，供提前排程）
function clickSound(acc, t) {
  ensureCtx();
  const freq = acc === 'strong' ? 1500 : (acc === 'mid' ? 1100 : 800);
  const base = acc === 'strong' ? 0.5 : (acc === 'mid' ? 0.4 : 0.3);
  const gain = base * (metroVol / 100);
  const o = metroCtx.createOscillator(), g = metroCtx.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  o.connect(g); g.connect(metroCtx.destination);
  o.start(t); o.stop(t + 0.05);
}
function setMetroVol(v) {
  metroVol = Math.max(20, Math.min(300, +v || 100));
  const lbl = document.getElementById('metroVolVal');
  if (lbl) lbl.textContent = metroVol + '%';
  localStorage.setItem('metro_vol', metroVol);
}
function initMetroVol() {
  const sv = parseInt(localStorage.getItem('metro_vol'), 10);
  if (!isNaN(sv)) metroVol = Math.max(20, Math.min(300, sv));
  const rng = document.getElementById('metroVol');
  const lbl = document.getElementById('metroVolVal');
  if (rng) rng.value = metroVol;
  if (lbl) lbl.textContent = metroVol + '%';
}
// 返回某拍在小结内的重音级别
function meterAccent(pos) {
  if (pos === 0) return 'strong';
  if (meterDen === 8 && meterNum % 3 === 0 && pos % 3 === 0) return 'mid'; // 6/8 · 9/8 · 12/8 复合拍
  if (meterNum === 5 && pos === 2) return 'mid';                              // 5/4（3+2 感）
  if (meterNum === 7 && (pos === 2 || pos === 4)) return 'mid';            // 7/8
  return 'weak';
}
function renderBeat() {
  const beatEl = document.getElementById('metroBeat');
  if (!beatEl) return;
  let html = '';
  for (let i = 0; i < meterNum; i++) {
    const a = meterAccent(i);
    const cls = a === 'strong' ? 'b-strong' : (a === 'mid' ? 'b-mid' : 'b-weak');
    html += '<span class="bdot ' + cls + '"></span>';
  }
  beatEl.innerHTML = html;
}
// 拍号可自由输入，如 "4/4" "6/8" "5/4"
function setMeter(v) {
  v = (v || '').trim();
  const m = v.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return; // 非法输入忽略，保留上一次
  const n = Math.max(1, Math.min(12, parseInt(m[1], 10)));
  const d = Math.max(1, Math.min(16, parseInt(m[2], 10)));
  meterNum = n; meterDen = d;
  const inp = document.getElementById('metroMeter');
  if (inp && inp.value !== n + '/' + d) inp.value = n + '/' + d;
  beatCount = 0;
  renderBeat();
  document.querySelectorAll('.metro-presets button').forEach(b => {
    b.classList.toggle('active', b.textContent === n + '/' + d);
  });
}
function highlightBeat(pos) {
  const beatEl = document.getElementById('metroBeat');
  if (!beatEl) return;
  const dots = beatEl.querySelectorAll('.bdot');
  dots.forEach((d, i) => { d.classList.toggle('cur', i === pos); });
}
// 调度器：每 25ms 唤醒一次，把未来 0.12s 内的拍按 AudioContext 时钟全部排程。
// 声音由音频时钟精确触发——页面切后台 setTimeout 被节流也不影响已排程的节拍，且长期运行无漂移。
function scheduleMetro() {
  if (!metroOn) return;
  while (nextNoteTime < metroCtx.currentTime + METRO_LOOKAHEAD) {
    const pos = beatCount % meterNum;
    clickSound(meterAccent(pos), nextNoteTime);
    // 亮灯与该拍发声时刻对齐（视觉仅作提示，允许轻微延迟）
    const delay = Math.max(0, (nextNoteTime - metroCtx.currentTime) * 1000);
    setTimeout(() => { if (metroOn) highlightBeat(pos); }, delay);
    nextNoteTime += 60 / metroBpm;
    beatCount++;
  }
  metroTimer = setTimeout(scheduleMetro, METRO_INTERVAL);
}
function metroToggle() {
  metroOn = !metroOn;
  const btn = document.getElementById('metroPlay');
  if (metroOn) {
    ensureCtx();
    if (metroCtx.state === 'suspended') metroCtx.resume();
    beatCount = 0;
    renderBeat();
    nextNoteTime = metroCtx.currentTime + 0.06; // 留 60ms 起音缓冲
    scheduleMetro();
    if (btn) btn.textContent = '⏸ 停止';
  } else {
    clearTimeout(metroTimer);
    if (btn) btn.textContent = '▶ 开始';
  }
}
// 输入过程中：只更新实际值和滑块，不回写输入框，允许自由编辑（如退格清空）
function onMetroBpmInput(v) {
  const n = +v;
  if (n >= 40 && n <= 240) {
    metroBpm = n;
    const rng = document.getElementById('metroRange');
    if (rng) rng.value = metroBpm;
  }
}
// 失焦时：clamp 并回写输入框，确保合法值
function setMetroBpm(v) {
  metroBpm = Math.max(40, Math.min(240, +v || 80));
  const inp = document.getElementById('metroBpmInput');
  const rng = document.getElementById('metroRange');
  if (inp) inp.value = metroBpm;
  if (rng) rng.value = metroBpm;
}
function toggleMetronome() {
  const m = document.getElementById('metro');
  if (m) m.style.display = m.style.display === 'none' ? '' : 'none';
}
let tapTimes = [];
function metroTap() {
  const now = performance.now();
  if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes = [];
  tapTimes.push(now);
  if (tapTimes.length > 4) tapTimes.shift();
  if (tapTimes.length >= 2) {
    const intervals = [];
    for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    setMetroBpm(Math.round(60000 / avg));
  }
}

// ======================== 和弦悬浮提示 ========================
const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
function chordInfo(name) {
  const m = name.match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return null;
  const root = m[1] + m[2];
  const qual = m[3] || '';
  let idx = SHARP.indexOf(root);
  if (idx < 0) idx = FLAT.indexOf(root);
  if (idx < 0) return null;
  let iv, label;
  // 先长后短匹配：add9/maj9/m9 等必须排在裸 9/7/m 之前，否则 Cadd9 会被误判成属九
  if (/maj7|maj9|M7/.test(qual)) { iv = [0,4,7,11]; label = '大七和弦'; }
  else if (/m7b5/.test(qual)) { iv = [0,3,6,10]; label = '半减七和弦'; }
  else if (/m9/.test(qual)) { iv = [0,3,7,10,14]; label = '小九和弦'; }
  else if (/m7/.test(qual)) { iv = [0,3,7,10]; label = '小七和弦'; }
  else if (/add9/.test(qual)) { iv = [0,4,7,14]; label = '加九和弦'; }
  else if (/9/.test(qual)) { iv = [0,4,7,10,14]; label = '属九和弦'; }
  else if (/7/.test(qual)) { iv = [0,4,7,10]; label = '属七和弦'; }
  else if (/6/.test(qual)) { iv = [0,4,7,9]; label = '六和弦'; }
  else if (/sus4/.test(qual)) { iv = [0,5,7]; label = '挂四和弦'; }
  else if (/sus2/.test(qual)) { iv = [0,2,7]; label = '挂二和弦'; }
  else if (/dim/.test(qual)) { iv = [0,3,6]; label = '减三和弦'; }
  else if (/aug|\+/.test(qual)) { iv = [0,4,8]; label = '增三和弦'; }
  else if (/m/.test(qual)) { iv = [0,3,7]; label = '小三和弦'; }
  else { iv = [0,4,7]; label = '大三和弦'; }
  const notes = iv.map(i => SHARP[(idx + i) % 12]);
  return { root: root, qual: qual, label: label, notes: notes };
}
const tip = document.getElementById('chordTip');
let tipVisible = false;
function showChordTip(text, e) {
  const info = chordInfo(text);
  if (!info) { hideChordTip(); return; }
  tip.innerHTML = '<div class="ct-name">' + text + '</div><div class="ct-label">' + info.label + '</div><div class="ct-notes">' + info.notes.join(' · ') + '</div>';
  tip.style.display = 'block';
  tipVisible = true;
  positionTip(e);
}
function positionTip(e) {
  const x = Math.min(e.clientX + 14, window.innerWidth - 200);
  const y = Math.min(e.clientY + 14, window.innerHeight - 100);
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function hideChordTip() { tip.style.display = 'none'; tipVisible = false; }
document.addEventListener('mouseover', e => { const el = e.target.closest('.measure-chord'); if (el) showChordTip(el.textContent, e); });
document.addEventListener('mousemove', e => { if (tipVisible) positionTip(e); });
document.addEventListener('mouseout', e => { const el = e.target.closest('.measure-chord'); if (el) hideChordTip(); });

// 窗口尺寸变化（如平板横竖屏切换）后，列宽改变，重新计算哪些小节需要加宽
let _fitRAF = 0;
window.addEventListener('resize', () => {
  if (_fitRAF) cancelAnimationFrame(_fitRAF);
  _fitRAF = requestAnimationFrame(() => {
    const db = document.getElementById('detailBody');
    if (db) fitMeasureWidths(db);
    const rp = document.getElementById('refPanelBody');
    if (rp) fitMeasureWidths(rp);
  });
});

// ======================== 临时歌单拖拽排序 ========================
let dragId = null;
tbody.addEventListener('dragstart', e => {
  const row = e.target.closest('.song-row');
  if (!row) return;
  dragId = +row.dataset.id;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
tbody.addEventListener('dragend', e => {
  const row = e.target.closest('.song-row');
  if (row) row.classList.remove('dragging');
  document.querySelectorAll('.song-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  dragId = null;
});
tbody.addEventListener('dragover', e => {
  if (currentTab !== 'temp' || dragId === null) return;
  const row = e.target.closest('.song-row');
  if (!row) return;
  e.preventDefault();
  document.querySelectorAll('.song-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  if (+row.dataset.id !== dragId) row.classList.add('drag-over');
});
tbody.addEventListener('drop', e => {
  if (currentTab !== 'temp' || dragId === null) return;
  e.preventDefault();
  const row = e.target.closest('.song-row');
  if (!row) return;
  const overId = +row.dataset.id;
  if (overId === dragId) return;
  const from = tempList.indexOf(dragId), to = tempList.indexOf(overId);
  if (from < 0 || to < 0) return;
  tempList.splice(from, 1);
  tempList.splice(to, 0, dragId);
  render();
});

// ======================== 键盘快捷键 ========================
document.addEventListener('keydown', e => {
  const inp = document.getElementById('search');
  if (e.key === 'Escape') {
    if (inp.value) { inp.value = ''; searchTerm = ''; document.getElementById('searchClear').classList.remove('visible'); render(); }
    inp.blur();
  }
});

// ======================== 搜索（防抖） ========================
let searchTimer = null;
document.getElementById('search').addEventListener('input', e => {
  const v = e.target.value.trim();
  const clearBtn = document.getElementById('searchClear');
  if (v) clearBtn.classList.add('visible'); else clearBtn.classList.remove('visible');
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { searchTerm = v; render(); }, 120);
});

// ======================== 初始化（异步加载曲库数据后执行） ========================
// 加载策略：先从 CDN 加载（快），如果本地有 token 则用 GitHub API 读最新内容覆盖（绕过 CDN 缓存）
let _everLoaded = false; // 首次加载后置 true（loadDataAndInit 会被 CDN fetch 和 GitHub API fetch 各调一次）
function loadDataAndInit(data) {
  const reLoad = _everLoaded;
  _everLoaded = true;

  // 二次加载（GitHub API 回包覆盖 CDN 旧缓存）时，先用"旧快照"找出本地未保存修改，
  // 避免全量替换把它们静默冲掉；策略与备注/歌词一致：远程为基底 + 本地修改覆盖。
  let editedSongById = {}, editedProg = {}, tempEdited = false;
  if (reLoad) {
    const initStr = {};
    _initSnap.songs.forEach(s => { initStr[s.id] = JSON.stringify(s); });
    songs.forEach(s => { if (JSON.stringify(s) !== initStr[s.id]) editedSongById[s.id] = s; });
    Object.keys(progMap).forEach(id => { if (!_eq(progMap[id], _initSnap.progMap[id])) editedProg[id] = progMap[id]; });
    tempEdited = !_eq(tempList, _initSnap.tempList);
  }

  songs = data.songs || [];
  progMap = data.progMap || {};
  if (reLoad) {
    // 本地改过元信息/对照表的歌：保留本地版本（远程新增的歌照常进来）
    if (Object.keys(editedSongById).length) songs = songs.map(rs => editedSongById[rs.id] || rs);
    // 本地改过的和弦条目：覆盖远程同 id 条目
    if (Object.keys(editedProg).length) progMap = Object.assign({}, progMap, editedProg);
  }
  // 临时歌单：本地改过则保留本地；否则采用远程（首次加载同理）
  if (Array.isArray(data.tempList) && !(reLoad && tempEdited)) tempList = data.tempList.slice();

  // 合并远程备注：以远程为基底，叠加本地"真正改过"的键（未改过的键不覆盖远程，避免吞掉他人更新）
  if (data.sectionNotes && typeof data.sectionNotes === 'object') {
    const remoteNotes = data.sectionNotes;
    const curNotes = {};
    // 仅二次加载时才存在"本地未保存修改"；首次加载时内存是内置默认值，应让位远程
    if (reLoad) {
      Object.keys(_sectionNotes).forEach(k => {
        if ((_sectionNotes[k] || '') !== (_initSnap.notes[k] || '')) curNotes[k] = _sectionNotes[k];
      });
    }
    Object.keys(_sectionNotes).forEach(k => { if (!(k in remoteNotes) && !(k in curNotes)) delete _sectionNotes[k]; });
    Object.assign(_sectionNotes, remoteNotes, curNotes);
  }
  // 合并远程歌词：同上
  if (data.sectionLyrics && typeof data.sectionLyrics === 'object') {
    const remoteLyrics = data.sectionLyrics;
    const curLyrics = {};
    if (reLoad) {
      Object.keys(_sectionLyrics).forEach(k => {
        if ((_sectionLyrics[k] || '') !== (_initSnap.lyrics[k] || '')) curLyrics[k] = _sectionLyrics[k];
      });
    }
    Object.keys(_sectionLyrics).forEach(k => { if (!(k in remoteLyrics) && !(k in curLyrics)) delete _sectionLyrics[k]; });
    Object.assign(_sectionLyrics, remoteLyrics, curLyrics);
  }
  applyVersion();
  selectKeyButton(transposeKey);
  setMetroBpm(metroBpm);
  initMetroVol();
  setMeter('4/4');
  updateStickyTop();
  render();
  renderRefPanel();
  if (reLoad) {
    // 二次加载：快照拍"远程原始数据"，使本地未保存修改在导出 diff 中依然可见
    _initSnap.songs = JSON.parse(JSON.stringify(data.songs || []));
    _initSnap.progMap = JSON.parse(JSON.stringify(data.progMap || {}));
    _initSnap.tempList = Array.isArray(data.tempList) ? data.tempList.slice() : tempList.slice();
    _initSnap.notes = JSON.parse(JSON.stringify(data.sectionNotes || {}));
    _initSnap.lyrics = JSON.parse(JSON.stringify(data.sectionLyrics || {}));
  } else {
    resetInitSnap(); // 首次加载完成后拍初始快照，供导出 diff 使用
  }
}
fetch('songs.json?t=' + Date.now(), { cache: 'no-store' })
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(data => {
    loadDataAndInit(data);
    // 如果本地存有 token，用 GitHub API 读最新内容覆盖（绕过 CDN 缓存延迟）
    const tok = localStorage.getItem('gh_token');
    if (tok) {
      fetch('https://api.github.com/repos/' + REPO + '/contents/songs.json', {
        headers: { 'Authorization': 'token ' + tok }
      })
        .then(r => { if (!r.ok) throw new Error('API ' + r.status); return r.json(); })
        .then(remote => {
          const latest = JSON.parse(base64ToUtf8(remote.content));
          loadDataAndInit(latest);
        })
        .catch(() => {}); // 静默失败，沿用 CDN 数据
    }
  })
  .catch(err => console.error('加载 songs.json 失败：', err));


/* ===== 全屏切换（安卓 Chrome：隐藏系统状态/导航栏，沉浸视奏） ===== */
function toggleFullscreen() {
  const el = document.documentElement;
  const inFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  try {
    if (!inFs()) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el);
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    }
  } catch (e) {
    console.warn('全屏切换失败：', e);
  }
}
function syncFsBtn() {
  const btn = document.getElementById('fsBtn');
  if (!btn) return;
  const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  btn.setAttribute('aria-label', inFs ? '退出全屏' : '全屏');
  btn.title = inFs ? '退出全屏' : '全屏 / 退出全屏';
  btn.style.opacity = inFs ? '0.35' : '1';
}
document.addEventListener('fullscreenchange', syncFsBtn);
document.addEventListener('webkitfullscreenchange', syncFsBtn);
