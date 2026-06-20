import './style.css';
import abcjs from 'abcjs';
import 'abcjs/abcjs-audio.css';

// Import Monaco Editor directly from local node_modules
import * as monaco from 'monaco-editor';

// Import workers using Vite's ?worker suffix for native worker support
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Define the global MonacoEnvironment to locate the web workers locally
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') {
      return new jsonWorker();
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker();
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker();
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  }
};

// ==========================================================================
// 1. Templates and Default Data
// ==========================================================================
const templates = {
  'ode-to-joy': `X: 1
T: Ode to Joy (歓喜の歌)
C: Ludwig van Beethoven
M: 4/4
L: 1/4
Q: 1/4=120
K: G
B B C' D' | D' C' B A | G G A B | B > A A2 |
B B C' D' | D' C' B A | G G A B | A > G G2 |
A A B G | A B/C'/ B G | A B/C'/ B A | G A D2 |
B B C' D' | D' C' B A | G G A B | A > G G2 |]`,

  'cooleys-reel': `X: 2
T: Cooley's Reel
M: 4/4
L: 1/8
R: reel
Q: 1/4=180
K: Edor
|:D2|EB{c}BA B2 EB|~B2 AB dBAG|FDAD BDAD|FDAD dAFD|
EBBA B2 EB|B2 AB defg|afe^c dBAF|DEFD E2:|
|:gf|eB~B2 efge|eB~B2 gedB|A2FA dAFD|A2FA beef|
g2fg eBdB|A2FA defg|afe^c dBAF|DEFD E2:|`,

  'twinkle': `X: 3
T: Twinkle Twinkle Little Star (きらきら星)
M: 4/4
L: 1/4
Q: 1/4=96
K: C
C C G G | A A G2 | F F E E | D D C2 |
G G F F | E E D2 | G G F F | E E D2 |
C C G G | A A G2 | F F E E | D D C2 |]`,

  'major-scale': `X: 4
T: C Major Scale & Arpeggio (ハ長調音階)
M: 4/4
L: 1/4
Q: 1/4=100
K: C
C D E F | G A B c | c B A G | F E D C |
[CEG]4 | [FAc]4 | [GBd]4 | [CEGc]4 |]`
};

// Default setup files
const initialFiles = {
  'welcome-score': {
    name: '新しいスコア.abc',
    content: `X: 1
T: Welcome to ABC Editor!
C: ABC Editor Team
M: 4/4
L: 1/4
Q: 1/4=110
K: C
% ここにABC記譜法で楽譜を入力してください
% 楽譜をクリックするとエディターの位置にジャンプします
C E G c | G E C2 | [CEG]4 | [DGB]4 | [CEGc]4 |]`
  },
  'ode-to-joy': {
    name: '歓喜の歌.abc',
    content: templates['ode-to-joy']
  }
};

// ==========================================================================
// 2. Global State Variables
// ==========================================================================
let files = {};
let activeFileId = '';
let monacoInstance = monaco; // Local Monaco instance
let editorInstance = null;
let synthControl = null;
let visualObj = null;

let zoomLevel = 100;
let darkScoreMode = false;

let isPlaying = false;
let synthNeedsUpdate = false;

let saveDebounceTimer = null;
let renderDebounceTimer = null;
let synthDebounceTimer = null;

// ==========================================================================
// 3. Monaco Editor ABC Language Syntax Definition
// ==========================================================================
const abcLanguageDef = {
  defaultToken: '',
  tokenPostfix: '.abc',
  tokenizer: {
    root: [
      // Headers: X: T: M: L: K: Q: C: at start of line
      [/^[A-Za-z]:\s*.*$/, 'meta.header'],
      
      // Comments
      [/%.*$/, 'comment'],
      
      // Chords like [CEG]
      [/\[[A-Gac-g^=_0-9'/ ,]+\]/, 'string.chord'],
      
      // Guitar chords in quotes "C" or "Am"
      [/"[^"\\]*"/, 'string.chord-name'],
      
      // Accidentals
      [/[\^=_]/, 'tag.accidental'],
      
      // Standard notes
      [/[A-Ga-g]/, 'keyword.note'],
      
      // Octave markers
      [/[,']/, 'number.octave'],
      
      // Note lengths
      [/[0-9]+\/[0-9]+/, 'number.length'],
      [/[0-9]+\//, 'number.length'],
      [/[0-9]+/, 'number.length'],
      [/\/+/, 'number.length'],
      
      // Bar lines
      [/\|[:\]]?/, 'delimiter.bar'],
      [/:\|/, 'delimiter.bar'],
      [/\[\|/, 'delimiter.bar'],
      [/\|\|/, 'delimiter.bar'],
      
      // Dynamics and annotations like !p! !ff!
      [/![a-zA-Z]+!/, 'variable.dynamic']
    ]
  }
};

const abcThemeDef = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'meta.header', foreground: '818cf8', fontStyle: 'bold' }, // Indigo
    { token: 'comment', foreground: '64748b', fontStyle: 'italic' },  // Slate
    { token: 'string.chord', foreground: 'f43f5e', fontStyle: 'bold' }, // Rose
    { token: 'string.chord-name', foreground: 'fbbf24', fontStyle: 'italic' }, // Amber
    { token: 'tag.accidental', foreground: '22d3ee', fontStyle: 'bold' }, // Cyan
    { token: 'keyword.note', foreground: '34d399', fontStyle: 'bold' },    // Emerald
    { token: 'number.octave', foreground: '60a5fa' },                 // Blue
    { token: 'number.length', foreground: 'c084fc' },                 // Purple
    { token: 'delimiter.bar', foreground: 'f8fafc', fontStyle: 'bold' },   // White
    { token: 'variable.dynamic', foreground: 'f472b6' }               // Pink
  ],
  colors: {
    'editor.background': '#11151d', // Matching var(--bg-panel)
    'editor.foreground': '#f1f5f9',
    'editor.lineHighlightBackground': '#1a202c',
    'editorLineNumber.foreground': '#475569',
    'editorLineNumber.activeForeground': '#818cf8',
    'editor.selectionBackground': '#2d3748',
    'editor.inactiveSelectionBackground': '#1a202c',
  }
};

const abcLightThemeDef = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'meta.header', foreground: '4f46e5', fontStyle: 'bold' }, // Indigo-600
    { token: 'comment', foreground: '64748b', fontStyle: 'italic' },  // Slate
    { token: 'string.chord', foreground: 'e11d48', fontStyle: 'bold' }, // Rose-600
    { token: 'string.chord-name', foreground: 'd97706', fontStyle: 'italic' }, // Amber-600
    { token: 'tag.accidental', foreground: '0891b2', fontStyle: 'bold' }, // Cyan-600
    { token: 'keyword.note', foreground: '059669', fontStyle: 'bold' },    // Emerald-600
    { token: 'number.octave', foreground: '2563eb' },                 // Blue-600
    { token: 'number.length', foreground: '7c3aed' },                 // Purple-600
    { token: 'delimiter.bar', foreground: '0f172a', fontStyle: 'bold' },   // Slate-900
    { token: 'variable.dynamic', foreground: 'db2777' }               // Pink-600
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#0f172a',
    'editor.lineHighlightBackground': '#f8fafc',
    'editorLineNumber.foreground': '#94a3b8',
    'editorLineNumber.activeForeground': '#4f46e5',
    'editor.selectionBackground': '#cbd5e1',
    'editor.inactiveSelectionBackground': '#e2e8f0',
  }
};

// ==========================================================================
// 4. Cursor Highlights during Playback
// ==========================================================================
const cursorControl = {
  onStart: function() {
    isPlaying = true;
    document.getElementById("playback-status").innerText = "再生中";
    clearNoteHighlights();
  },
  onEvent: function(ev) {
    if (ev.measureStart && ev.left === null) return;
    
    clearNoteHighlights();
    
    // Highlight currently sounding notes in SVG
    if (ev.elements) {
      ev.elements.forEach(systems => {
        systems.forEach(el => {
          el.classList.add("abcjs-cursor");
        });
      });
    }
  },
  onFinished: function() {
    isPlaying = false;
    document.getElementById("playback-status").innerText = "再生終了";
    clearNoteHighlights();
    
    // If user edited during playback, reload synth now
    if (synthNeedsUpdate) {
      updateSynth();
    }
  }
};

function clearNoteHighlights() {
  const elements = document.querySelectorAll("#notation-paper .abcjs-cursor");
  elements.forEach(el => el.classList.remove("abcjs-cursor"));
}

// ==========================================================================
// 5. Initializing LocalStorage & Data
// ==========================================================================
function loadStorageData() {
  const storedFiles = localStorage.getItem('abc_editor_scores');
  const storedActive = localStorage.getItem('abc_editor_active_id');
  
  if (storedFiles) {
    files = JSON.parse(storedFiles);
    // Migrate: Update "Ode to Joy" if it still has the old pitch format (B B C D)
    if (files['ode-to-joy'] && typeof files['ode-to-joy'].content === 'string') {
      if (files['ode-to-joy'].content.includes("B B C D | D C B A")) {
        files['ode-to-joy'].content = templates['ode-to-joy'];
        localStorage.setItem('abc_editor_scores', JSON.stringify(files));
      }
    }
  } else {
    files = { ...initialFiles };
    localStorage.setItem('abc_editor_scores', JSON.stringify(files));
  }
  
  if (storedActive && files[storedActive]) {
    activeFileId = storedActive;
  } else {
    activeFileId = Object.keys(files)[0] || 'welcome-score';
    localStorage.setItem('abc_editor_active_id', activeFileId);
  }
}

function saveStorageData() {
  localStorage.setItem('abc_editor_scores', JSON.stringify(files));
}

// ==========================================================================
// 6. BPM & Header Parser Helper
// ==========================================================================
function getBpmFromScore(abcContent) {
  // Q: 1/4=120 or Q:120 or Q: 90
  const match = abcContent.match(/^Q:\s*(?:[0-9/]+=)?\s*([0-9]+)/m);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 120; // fallback BPM
}

// ==========================================================================
// 7. Visual Render and Warnings Parser
// ==========================================================================
function renderScore(abcContent) {
  try {
    const scaleFactor = zoomLevel / 100;
    const visualObjs = abcjs.renderAbc("notation-paper", abcContent, {
      responsive: "resize",
      scale: scaleFactor,
      add_classes: true,
      clickListener: handleNoteClick
    });
    
    visualObj = visualObjs[0];
    
    // Parse warnings / error messages
    const warnings = visualObj.warnings || [];
    parseWarnings(warnings);
    
    // Audio synthesizer updates (always update with a snappy 400ms debounce)
    if (synthDebounceTimer) clearTimeout(synthDebounceTimer);
    synthDebounceTimer = setTimeout(() => {
      updateSynth();
    }, 400);
  } catch (error) {
    console.error("Score rendering error: ", error);
  }
}

function parseWarnings(warnings) {
  const warningsListEl = document.getElementById("warnings-list");
  const warningsContainerEl = document.getElementById("compilation-warnings");
  const warningCountTextEl = document.getElementById("warning-count-text");
  
  warningsListEl.innerHTML = "";
  const markers = [];
  
  if (warnings && warnings.length > 0) {
    warningsContainerEl.classList.remove("hidden");
    warningCountTextEl.innerText = `${warnings.length} 件の警告があります`;
    
    warnings.forEach((warning, idx) => {
      let message = "";
      let lineNum = 1;
      let colNum = 1;
      
      if (typeof warning === 'string') {
        message = warning;
        // Search for line numbers in warning string (e.g., "line 4:")
        const match = warning.match(/line\s*([0-9]+)/i);
        if (match) {
          lineNum = parseInt(match[1], 10);
        }
      } else if (warning && typeof warning === 'object') {
        message = warning.message || JSON.stringify(warning);
        lineNum = warning.line || 1;
        colNum = warning.column || 1;
      }
      
      // Add Monaco diagnostics
      if (monacoInstance && editorInstance) {
        markers.push({
          severity: monacoInstance.MarkerSeverity.Warning,
          message: message,
          startLineNumber: lineNum,
          startColumn: colNum || 1,
          endLineNumber: lineNum,
          endColumn: (colNum || 1) + 8
        });
      }
      
      // Add visual row item
      const li = document.createElement("li");
      li.className = "warning-row-item";
      li.innerHTML = `<span class="warning-line-badge">行 ${lineNum}</span> ${message}`;
      li.addEventListener("click", () => {
        if (editorInstance) {
          editorInstance.setPosition({ lineNumber: lineNum, column: colNum || 1 });
          editorInstance.revealLineInCenter(lineNum);
          editorInstance.focus();
        }
      });
      warningsListEl.appendChild(li);
    });
    
    if (monacoInstance && editorInstance) {
      monacoInstance.editor.setModelMarkers(editorInstance.getModel(), "abcjs", markers);
    }
  } else {
    warningsContainerEl.classList.add("hidden");
    if (monacoInstance && editorInstance) {
      monacoInstance.editor.setModelMarkers(editorInstance.getModel(), "abcjs", []);
    }
  }
}

// Click on SVG Note jumps cursor in Monaco Editor
function handleNoteClick(abcElem) {
  if (!abcElem || !editorInstance) return;
  
  const startChar = abcElem.startChar;
  const endChar = abcElem.endChar;
  
  if (startChar !== undefined && endChar !== undefined) {
    const model = editorInstance.getModel();
    const startPos = model.getPositionAt(startChar);
    const endPos = model.getPositionAt(endChar);
    
    editorInstance.setSelection(new monacoInstance.Range(
      startPos.lineNumber, startPos.column,
      endPos.lineNumber, endPos.column
    ));
    editorInstance.revealRangeInCenterIfOutsideViewport(new monacoInstance.Range(
      startPos.lineNumber, startPos.column,
      endPos.lineNumber, endPos.column
    ));
    editorInstance.focus();
  }
}

// ==========================================================================
// 8. Synthesizer Setup and Updates
// ==========================================================================
function updateSynth() {
  if (!abcjs.synth.supportsAudio()) {
    document.getElementById("playback-status").innerText = "オーディオ非対応";
    return;
  }
  
  if (!visualObj) return;
  
  document.getElementById("playback-status").innerText = "ロード中...";
  
  // Stop and disable the old synth control if it exists to free audio nodes
  if (synthControl) {
    try {
      synthControl.stop();
      synthControl.disable(true);
    } catch (e) {
      console.warn("Error stopping synth: ", e);
    }
  }
  
  // Clear the panel to force recreation of the audio controls
  document.getElementById("audio-controls-panel").innerHTML = "";
  
  // Create a brand new SynthController to ensure no cached state remains
  synthControl = new abcjs.synth.SynthController();
  synthControl.load("#audio-controls-panel", cursorControl, {
    displayRestart: true,
    displayPlay: true,
    displayProgress: true,
    displayLoop: true,
    displayWarp: true
  });
  
  const bpm = getBpmFromScore(editorInstance.getValue());
  
  synthControl.setTune(visualObj, false, {
    qpm: bpm,
    soundFontUrl: "https://paulrosen.github.io/midi-js-soundfonts/abcjs/"
  }).then(() => {
    document.getElementById("playback-status").innerText = "再生準備完了";
    synthNeedsUpdate = false;
  }).catch(error => {
    console.warn("Synth initialization failed: ", error);
    document.getElementById("playback-status").innerText = "シンセロード失敗";
  });
}

// ==========================================================================
// 9. Auto Save Implementation (VSCode-like)
// ==========================================================================
function triggerAutoSave(content) {
  const saveIndicator = document.getElementById("save-indicator");
  
  // Set status to Saving...
  saveIndicator.classList.add("saving");
  saveIndicator.querySelector(".text").innerText = "Saving";
  
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  
  saveDebounceTimer = setTimeout(() => {
    // Write content
    if (files[activeFileId]) {
      files[activeFileId].content = content;
      saveStorageData();
    }
    
    // Status saved
    saveIndicator.classList.remove("saving");
    saveIndicator.querySelector(".text").innerText = "Saved";
    
    // Snappier visual render debounce (100ms)
    if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
    renderDebounceTimer = setTimeout(() => {
      renderScore(content);
    }, 100);
    
  }, 300); // Snappier auto-save debounce of 300ms
}

function triggerForcedSave() {
  const content = editorInstance.getValue();
  if (files[activeFileId]) {
    files[activeFileId].content = content;
    saveStorageData();
  }
  
  const saveIndicator = document.getElementById("save-indicator");
  saveIndicator.classList.remove("saving");
  saveIndicator.querySelector(".text").innerText = "Saved (強制)";
  
  renderScore(content);
}

// ==========================================================================
// 10. Sidebar File Manager Controls
// ==========================================================================
function renderScoreList() {
  const scoreListEl = document.getElementById("score-list");
  scoreListEl.innerHTML = "";
  
  Object.keys(files).forEach(id => {
    const file = files[id];
    const isActive = id === activeFileId;
    
    const item = document.createElement("div");
    item.className = `score-item ${isActive ? 'active' : ''}`;
    item.dataset.id = id;
    
    const nameSpan = document.createElement("span");
    nameSpan.className = "score-name";
    nameSpan.innerText = file.name;
    item.appendChild(nameSpan);
    
    // Rename on double click
    item.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      enableRename(id, nameSpan);
    });
    
    // Actions container
    const actions = document.createElement("div");
    actions.className = "score-item-actions";
    
    // Delete Button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "score-action-btn";
    deleteBtn.title = "削除";
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
    
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteScore(id);
    });
    
    actions.appendChild(deleteBtn);
    item.appendChild(actions);
    
    // Switch file on click
    item.addEventListener("click", () => {
      if (activeFileId !== id) {
        switchActiveFile(id);
      }
    });
    
    scoreListEl.appendChild(item);
  });
}

function switchActiveFile(id) {
  // If playing, pause first
  if (isPlaying && synthControl) {
    const pauseBtn = document.querySelector(".abcjs-midi-pause");
    if (pauseBtn) pauseBtn.click();
  }
  
  activeFileId = id;
  localStorage.setItem('abc_editor_active_id', id);
  
  // Set UI Headers
  document.getElementById("active-file-name").innerText = files[id].name;
  document.getElementById("playback-tune-title").innerText = files[id].name;
  
  // Update Monaco content
  if (editorInstance) {
    editorInstance.setValue(files[id].content);
  }
  
  renderScoreList();
  renderScore(files[id].content);
}

function enableRename(id, element) {
  const originalName = files[id].name;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "score-name-input";
  input.value = originalName;
  
  element.replaceWith(input);
  input.focus();
  input.select();
  
  const finishRename = () => {
    const newName = input.value.trim() || originalName;
    files[id].name = newName.endsWith('.abc') ? newName : newName + '.abc';
    saveStorageData();
    renderScoreList();
    if (id === activeFileId) {
      document.getElementById("active-file-name").innerText = files[id].name;
      document.getElementById("playback-tune-title").innerText = files[id].name;
    }
  };
  
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      finishRename();
    } else if (e.key === "Escape") {
      renderScoreList(); // restore
    }
  });
  
  input.addEventListener("blur", finishRename);
}

function createNewScore() {
  const name = prompt("新しい楽譜の名前を入力してください:", "Untitled.abc");
  if (name === null) return;
  
  const cleanName = name.trim() || "Untitled.abc";
  const finalName = cleanName.endsWith('.abc') ? cleanName : cleanName + '.abc';
  
  const id = 'score-' + Date.now();
  files[id] = {
    name: finalName,
    content: `X: 1
T: ${finalName.replace('.abc', '')}
M: 4/4
L: 1/4
Q: 1/4=120
K: C
% 新しいメロディを記述します
C D E F | G A B c |]`
  };
  
  saveStorageData();
  switchActiveFile(id);
}

function handleImportAbc(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const content = evt.target.result;
      const fileName = file.name || "Imported.abc";
      const cleanName = fileName.endsWith('.abc') ? fileName : fileName + '.abc';
      
      const id = 'score-' + Date.now();
      files[id] = {
        name: cleanName,
        content: content
      };
      
      saveStorageData();
      renderScoreList();
      switchActiveFile(id);
      
      // Reset input value so same file can be loaded again if deleted
      e.target.value = "";
    } catch (err) {
      console.error("Failed to parse imported ABC file:", err);
      alert("ファイルの読み込み中にエラーが発生しました。");
    }
  };
  reader.onerror = function() {
    alert("ファイルの読み込みに失敗しました。");
  };
  reader.readAsText(file);
}

function deleteScore(id) {
  const count = Object.keys(files).length;
  if (count <= 1) {
    alert("すべての楽譜を削除することはできません。少なくとも1つの楽譜を残す必要があります。");
    return;
  }
  
  if (!confirm(`「${files[id].name}」を削除してもよろしいですか？`)) return;
  
  delete files[id];
  saveStorageData();
  
  if (activeFileId === id) {
    const remainingIds = Object.keys(files);
    switchActiveFile(remainingIds[0]);
  } else {
    renderScoreList();
  }
}

// ==========================================================================
// 11. Print and Exporters
// ==========================================================================
function triggerPrint() {
  const paper = document.getElementById("notation-paper");
  const printSection = document.getElementById("print-section");
  if (paper && printSection) {
    printSection.innerHTML = paper.innerHTML;
    window.print();
    printSection.innerHTML = ""; // Clear content after print dialog
  }
}

function triggerCopyAbc() {
  if (!editorInstance) return;
  const content = editorInstance.getValue();
  navigator.clipboard.writeText(content).then(() => {
    const btn = document.getElementById("btn-copy-abc");
    const originalText = btn.innerText;
    btn.innerText = "コピー完了!";
    btn.style.borderColor = "var(--color-success)";
    btn.style.color = "var(--color-success)";
    
    setTimeout(() => {
      btn.innerText = originalText;
      btn.style.borderColor = "";
      btn.style.color = "";
    }, 1500);
  }).catch(err => {
    console.error("Clipboard copy failed: ", err);
  });
}

function getTitleFromScore(abcContent, fallback = "ABC Score") {
  const match = abcContent.match(/^T:\s*([^\n\r]+)/m);
  if (match) {
    return match[1].trim();
  }
  return fallback;
}

function prepareAbcForMidi(content) {
  const lines = content.split(/\r?\n/);
  let hasVoice = false;
  
  const modifiedLines = lines.map(line => {
    const voiceMatch = line.match(/^V:\s*([a-zA-Z0-9_]+)(.*)$/);
    if (voiceMatch) {
      hasVoice = true;
      const voiceId = voiceMatch[1];
      let remaining = voiceMatch[2];
      
      // Match name="something" or name=something
      const nameMatch = remaining.match(/name=(?:"([^"]+)"|([^\s]+))/i);
      const defaultName = isNaN(voiceId) ? voiceId : `Voice ${voiceId}`;
      
      if (nameMatch) {
        const originalName = nameMatch[1] || nameMatch[2];
        let safeName = originalName.replace(/[^\x00-\x7F]/g, "").trim();
        if (!safeName) {
          safeName = defaultName;
        }
        remaining = remaining.replace(nameMatch[0], `name="${safeName}"`);
      } else {
        remaining = ` name="${defaultName}"` + remaining;
      }
      return `V: ${voiceId}${remaining}`;
    }
    return line;
  });
  
  let midiContent = modifiedLines.join('\n');
  
  // If no voice headers at all, inject default voice
  if (!hasVoice) {
    const kHeaderMatch = midiContent.match(/^K:\s*([^\n\r]*)/m);
    if (kHeaderMatch) {
      const kLine = kHeaderMatch[0];
      midiContent = midiContent.replace(kLine, `${kLine}\nV: 1 name="Melody"`);
    }
  }
  
  return midiContent;
}

function parseMidi(midiBytes) {
  if (midiBytes.length < 14) return null;
  if (midiBytes[0] !== 0x4D || midiBytes[1] !== 0x54 || midiBytes[2] !== 0x68 || midiBytes[3] !== 0x64) {
    return null;
  }
  
  const numTracks = (midiBytes[10] << 8) | midiBytes[11];
  const tracks = [];
  let offset = 14;
  
  for (let t = 0; t < numTracks; t++) {
    if (offset + 8 > midiBytes.length) break;
    if (midiBytes[offset] !== 0x4D || midiBytes[offset+1] !== 0x54 || midiBytes[offset+2] !== 0x72 || midiBytes[offset+3] !== 0x6B) {
      break;
    }
    
    const trackLen = (midiBytes[offset+4] << 24) | (midiBytes[offset+5] << 16) | (midiBytes[offset+6] << 8) | midiBytes[offset+7];
    if (offset + 8 + trackLen > midiBytes.length) break;
    
    const trackData = midiBytes.subarray(offset + 8, offset + 8 + trackLen);
    tracks.push({
      header: midiBytes.subarray(offset, offset + 8),
      data: trackData
    });
    offset += 8 + trackLen;
  }
  
  return {
    header: midiBytes.subarray(0, 14),
    tracks: tracks
  };
}

function rebuildMidi(parsed) {
  let totalLen = parsed.header.length;
  for (const track of parsed.tracks) {
    totalLen += 8 + track.data.length;
  }
  
  const out = new Uint8Array(totalLen);
  out.set(parsed.header, 0);
  
  let offset = parsed.header.length;
  for (const track of parsed.tracks) {
    out.set(track.header.subarray(0, 4), offset);
    const len = track.data.length;
    out[offset+4] = (len >> 24) & 0xFF;
    out[offset+5] = (len >> 16) & 0xFF;
    out[offset+6] = (len >> 8) & 0xFF;
    out[offset+7] = len & 0xFF;
    out.set(track.data, offset + 8);
    offset += 8 + len;
  }
  
  return out;
}

function filterMetaEvents(trackData, typesToRemove) {
  const result = [];
  let i = 0;
  
  while (i < trackData.length) {
    const eventStart = i;
    
    let deltaTimeLen = 0;
    while (i < trackData.length) {
      deltaTimeLen++;
      if (trackData[i++] < 128) break;
    }
    
    if (i >= trackData.length) break;
    const status = trackData[i++];
    
    if (status === 0xFF) {
      if (i + 1 >= trackData.length) break;
      const type = trackData[i++];
      
      let metaLen = 0;
      let shift = 0;
      while (i < trackData.length) {
        const b = trackData[i++];
        metaLen |= (b & 0x7F) << shift;
        shift += 7;
        if (b < 128) break;
      }
      
      i += metaLen;
      
      if (typesToRemove.includes(type)) {
        continue;
      }
    } else if (status === 0xF0 || status === 0xF7) {
      let sysLen = 0;
      let shift = 0;
      while (i < trackData.length) {
        const b = trackData[i++];
        sysLen |= (b & 0x7F) << shift;
        shift += 7;
        if (b < 128) break;
      }
      i += sysLen;
    } else {
      const highNibble = status & 0xF0;
      if (highNibble === 0xC0 || highNibble === 0xD0) {
        i += 1;
      } else {
        i += 2;
      }
    }
    
    const eventBytes = trackData.subarray(eventStart, i);
    for (let j = 0; j < eventBytes.length; j++) {
      result.push(eventBytes[j]);
    }
  }
  
  return new Uint8Array(result);
}

function injectTrackName(trackData, trackName) {
  const cleanedData = filterMetaEvents(trackData, [0x03]);
  
  let safeName = trackName.replace(/[^\x00-\x7F]/g, "").trim();
  if (!safeName) {
    safeName = "Melody";
  }
  
  const nameBytes = [];
  nameBytes.push(0x00, 0xFF, 0x03);
  
  const nameAscii = [];
  for (let i = 0; i < safeName.length; i++) {
    nameAscii.push(safeName.charCodeAt(i));
  }
  
  const len = nameAscii.length;
  if (len >= 128) {
    return trackData;
  }
  nameBytes.push(len);
  nameBytes.push(...nameAscii);
  
  const result = new Uint8Array(nameBytes.length + cleanedData.length);
  result.set(new Uint8Array(nameBytes), 0);
  result.set(cleanedData, nameBytes.length);
  return result;
}

function processMidiTracks(midiBytes, songTitle) {
  const parsed = parseMidi(midiBytes);
  if (!parsed) return midiBytes;
  
  // Track 0: remove all Text (0x01) and Track Name (0x03) events
  if (parsed.tracks.length > 0) {
    parsed.tracks[0].data = filterMetaEvents(parsed.tracks[0].data, [0x01, 0x03]);
  }
  
  // Track 1: If there is exactly one melody track, name it after the song title.
  if (parsed.tracks.length === 2) {
    parsed.tracks[1].data = injectTrackName(parsed.tracks[1].data, songTitle);
  }
  
  return rebuildMidi(parsed);
}

function triggerDownloadMidi() {
  if (!editorInstance) return;
  const content = editorInstance.getValue();
  
  try {
    // Standardize ABC content for MIDI generation (inject voice names if missing)
    const midiContent = prepareAbcForMidi(content);

    const midiData = abcjs.synth.getMidiFile(midiContent, {
      midiOutputType: 'binary'
    });
    
    if (!midiData) {
      alert("MIDIファイルの出力に失敗しました。ABCコードが正しいか確認してください。");
      return;
    }
    
    // Handle both single items and array outputs safely
    let rawData = midiData;
    if (Array.isArray(midiData)) {
      if (midiData.length === 0) {
        alert("MIDIファイルの出力に失敗しました。");
        return;
      }
      rawData = midiData[0];
    }
    
    // Post-process MIDI binary data to name Track 1 (Melody track) and strip names from Track 0
    if (rawData instanceof Uint8Array) {
      const songTitle = getTitleFromScore(content, "ABC Score");
      rawData = processMidiTracks(rawData, songTitle);
    }
    
    // Wrap to Blob depending on return format (Blob vs Uint8Array)
    let finalBlob;
    if (rawData instanceof Blob) {
      finalBlob = rawData;
    } else {
      finalBlob = new Blob([rawData], { type: "audio/midi" });
    }
    
    const url = URL.createObjectURL(finalBlob);
    const link = document.createElement('a');
    link.href = url;
    
    const title = files[activeFileId].name.replace(/\.abc$/i, '');
    // Keep original filename (including Japanese characters) for the download,
    // only strip characters that are illegal in file names.
    const safeTitle = title.replace(/[\\\/:*?"<>|]/g, '').trim() || "abc_score";
    link.download = `${safeTitle}.mid`;
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    
    // Deferred revocation to let the browser safely download the blob before it is garbage collected
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  } catch (error) {
    console.error("MIDI export failed: ", error);
    alert("MIDI出力中にエラーが発生しました。");
  }
}

function triggerDownloadAbc() {
  if (!editorInstance) return;
  const content = editorInstance.getValue();
  
  try {
    const finalBlob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(finalBlob);
    const link = document.createElement('a');
    link.href = url;
    
    const title = files[activeFileId].name.replace(/\.abc$/i, '');
    const safeTitle = title.replace(/[\\\/:*?"<>|]/g, '').trim() || "abc_score";
    link.download = `${safeTitle}.abc`;
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  } catch (error) {
    console.error("ABC file export failed: ", error);
    alert("ABCファイルの保存中にエラーが発生しました。");
  }
}

// ==========================================================================
// 12. Accordions and Layout Controls
// ==========================================================================
function setupSidebarAccordions() {
  const collapsibles = document.querySelectorAll(".sidebar-section-header.collapsible");
  collapsibles.forEach(header => {
    header.addEventListener("click", () => {
      header.classList.toggle("collapsed");
    });
  });
}

function setupZoomControl() {
  const range = document.getElementById("zoom-range");
  const valueLabel = document.getElementById("zoom-value");
  const paper = document.getElementById("notation-paper");
  
  range.addEventListener("input", (e) => {
    zoomLevel = parseInt(e.target.value, 10);
    valueLabel.innerText = `${zoomLevel}%`;
    
    // Quick local scale adjustment for high responsiveness
    paper.style.transform = `scale(${zoomLevel / 100})`;
    
    // Debounce re-rendering for proper layout
    if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
    renderDebounceTimer = setTimeout(() => {
      if (editorInstance) renderScore(editorInstance.getValue());
    }, 150);
  });
}

function setupDarkScoreToggle() {
  const toggle = document.getElementById("chk-dark-score");
  const paper = document.getElementById("notation-paper");
  
  const setDarkScore = (isDark) => {
    darkScoreMode = isDark;
    toggle.checked = isDark;
    if (isDark) {
      paper.classList.add("dark-score");
    } else {
      paper.classList.remove("dark-score");
    }
  };
  
  // Detect OS dark mode preferences initially
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  setDarkScore(mediaQuery.matches);
  
  // UI manual toggle listener
  toggle.addEventListener("change", (e) => {
    setDarkScore(e.target.checked);
  });
  
  // Listen to OS system dark mode changes in real-time
  try {
    mediaQuery.addEventListener('change', (e) => {
      setDarkScore(e.matches);
    });
  } catch (err) {
    // Fallback for older browsers
    try {
      mediaQuery.addListener((e) => {
        setDarkScore(e.matches);
      });
    } catch (e2) {}
  }
}

function setupTemplateLoaders() {
  const buttons = document.querySelectorAll(".example-item");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const templateName = btn.dataset.template;
      if (templates[templateName]) {
        if (confirm("現在のエディター内容を上書きして、このサンプルをロードしてもよろしいですか？")) {
          if (editorInstance) {
            editorInstance.setValue(templates[templateName]);
          }
        }
      }
    });
  });
}

function setupSidebarToggle() {
  const btn = document.getElementById("btn-toggle-sidebar");
  const sidebar = document.getElementById("sidebar");
  
  btn.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    // Trigger editor layout recalculation
    setTimeout(() => {
      if (editorInstance) editorInstance.layout();
    }, 310);
  });
}

// ==========================================================================
// 13. DOM & Monaco Editor Initialization (Fully Local Setup)
// ==========================================================================
function setupThemeToggler() {
  let isLight = false;
  const storedTheme = localStorage.getItem('abc_editor_light_theme');
  
  if (storedTheme !== null) {
    isLight = storedTheme === 'true';
  } else {
    // Detect system theme if no user preference is stored
    isLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  }
  
  if (isLight) {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }
  
  const toggleBtn = document.getElementById("btn-toggle-theme");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const isLightNow = document.body.classList.toggle('light-theme');
      localStorage.setItem('abc_editor_light_theme', isLightNow ? 'true' : 'false');
      if (editorInstance) {
        editorInstance.updateOptions({ theme: isLightNow ? 'abc-light' : 'abc-dark' });
      }
    });
  }
}

window.addEventListener('load', () => {
  // A. Initialize Theme
  setupThemeToggler();

  // B. Load LocalStorage Data
  loadStorageData();
  
  // Set active file header name
  document.getElementById("active-file-name").innerText = files[activeFileId].name;
  document.getElementById("playback-tune-title").innerText = files[activeFileId].name;
  
  // C. Sidebar Files rendering
  renderScoreList();
  setupSidebarAccordions();
  setupTemplateLoaders();
  
  // D. Toolbar and Print Bindings
  setupZoomControl();
  setupDarkScoreToggle();
  setupSidebarToggle();
  
  document.getElementById("btn-new-score").addEventListener("click", createNewScore);
  document.getElementById("btn-copy-abc").addEventListener("click", triggerCopyAbc);
  document.getElementById("btn-print-pdf").addEventListener("click", triggerPrint);
  document.getElementById("btn-download-abc").addEventListener("click", triggerDownloadAbc);
  document.getElementById("btn-download-midi").addEventListener("click", triggerDownloadMidi);
  
  const importBtn = document.getElementById("btn-import-abc");
  const fileInput = document.getElementById("import-abc-file");
  if (importBtn && fileInput) {
    importBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", handleImportAbc);
  }
  
  // Audio Controller pause/stop click hooks to sync playing states
  document.getElementById('audio-controls-panel').addEventListener('click', (e) => {
    if (e.target.closest('.abcjs-midi-reset') || e.target.closest('.abcjs-midi-pause')) {
      isPlaying = false;
      document.getElementById("playback-status").innerText = "一時停止中";
      if (synthNeedsUpdate) {
        updateSynth();
      }
    }
  });

  // E. Initialize local Monaco Editor (No CDN loader needed!)
  try {
    // Register custom language 'abc'
    monacoInstance.languages.register({ id: 'abc' });
    monacoInstance.languages.setMonarchTokensProvider('abc', abcLanguageDef);
    monacoInstance.editor.defineTheme('abc-dark', abcThemeDef);
    monacoInstance.editor.defineTheme('abc-light', abcLightThemeDef);
    
    const initialTheme = document.body.classList.contains('light-theme') ? 'abc-light' : 'abc-dark';
    
    // Instantiate Monaco directly from our import
    editorInstance = monacoInstance.editor.create(document.getElementById('monaco-editor-container'), {
      value: files[activeFileId].content,
      language: 'abc',
      theme: initialTheme,
      automaticLayout: true,
      fontSize: 14,
      fontFamily: "'Fira Code', var(--font-mono)",
      minimap: { enabled: false },
      lineHeight: 22,
      tabSize: 4,
      scrollBeyondLastLine: false,
      padding: { top: 10, bottom: 10 }
    });
    
    // Track cursor line/col
    editorInstance.onDidChangeCursorPosition((e) => {
      const position = e.position;
      document.getElementById("line-col-status").innerText = `Ln ${position.lineNumber}, Col ${position.column}`;
    });
    
    // Track edits for auto-save (VSCode-like)
    editorInstance.onDidChangeModelContent(() => {
      const value = editorInstance.getValue();
      triggerAutoSave(value);
    });
    
    // Bind Force Save (Cmd+S / Ctrl+S)
    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      triggerForcedSave();
    });
    
    // Initial Render
    renderScore(files[activeFileId].content);
  } catch (error) {
    console.error("Monaco Editor failed to initialize locally: ", error);
    document.getElementById("monaco-editor-container").innerHTML = `
      <div style="padding: 20px; color: #ef4444; font-family: sans-serif;">
        <h4>エディターの初期化に失敗しました</h4>
        <p>${error.message || error}</p>
      </div>`;
  }
});
