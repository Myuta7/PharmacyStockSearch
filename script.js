"use strict";

// 入力フィールドの数
const FIELD_COUNT = 10;
// サジェストに表示する最大件数
const MAX_SUGGEST = 30;
// 在庫データ CSV のファイル名（UTF-8 版を優先。取得できなければ Shift-JIS 版へフォールバック）
const CSV_FILE_UTF8 = "StockData_utf8.csv";
const CSV_FILE_SJIS = "StockData.csv";

// メモリ上に保持する在庫データ：{ name, normName, shelves[] }
let stockData = [];

/* ------------------------------------------------------------------ */
/* 文字列正規化                                                        */
/*   NFKC 正規化で、半角カナ⇔全角カナ・全角数字⇔半角数字などを統一。   */
/*   例）"ｱﾑ" → "アム"、"１０" → "10"、"ＭＧ" → "MG"                     */
/*   さらに小文字化して大小文字差を無視し、                            */
/*   カタカナ→ひらがなに寄せてひらがな⇔カタカナの差も吸収する。        */
/*   例）"アムロ"・"ｱﾑﾛ"・"あむろ" → すべて "あむろ"                    */
/* ------------------------------------------------------------------ */
function normalize(str) {
  return str
    .normalize("NFKC")
    .toLowerCase()
    // カタカナ(ァ〜ヶ, U+30A1〜U+30F6) → 対応するひらがなへ変換
    .replace(/[ァ-ヶ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
}

/* ------------------------------------------------------------------ */
/* CSV の読み込み                                                      */
/*   まず UTF-8 版を読む。存在しない・失敗した場合は Shift-JIS 版を    */
/*   TextDecoder でデコードして読む（フォールバック）。                 */
/* ------------------------------------------------------------------ */
async function loadStock() {
  // 1) UTF-8 版を試す
  try {
    const res = await fetch(CSV_FILE_UTF8);
    if (res.ok) {
      const text = await res.text(); // UTF-8 として解釈
      parseCsv(text);
      return;
    }
  } catch (_) {
    // ネットワークエラー等はフォールバックへ
  }

  // 2) フォールバック：Shift-JIS 版
  const res = await fetch(CSV_FILE_SJIS);
  if (!res.ok) {
    throw new Error("CSV を取得できませんでした (HTTP " + res.status + ")");
  }
  const buffer = await res.arrayBuffer();
  const text = new TextDecoder("shift-jis").decode(buffer);
  parseCsv(text);
}

/* 1 行分を列に分解する CSV パーサ。
   フィールドはダブルクォートで囲まれている場合があり（例 "舌下錠2,000JAU"）、
   その中のカンマは区切りとして扱わない。連続する "" はエスケープされた
   ダブルクォート 1 文字として扱う。クォート無しのフィールドもそのまま読む。 */
function parseCsvLine(line) {
  const cols = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'; // エスケープされた "
          i++;
        } else {
          inQuotes = false; // クォート終了
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cols.push(field);
        field = "";
      } else {
        field += ch;
      }
    }
  }
  cols.push(field);
  return cols;
}

/* CSV を解析して stockData を構築。
   列構成：1 列目＝薬品名、2 列目以降＝棚番（棚番1〜棚番7、空欄あり）。 */
function parseCsv(text) {
  const lines = text.split(/\r\n|\n|\r/);
  stockData = [];

  // 1 行目はヘッダーなので飛ばす
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    const cols = parseCsvLine(line);
    const name = (cols[0] || "").trim();
    if (name === "") continue;

    // 2 列目以降（index 1〜）が棚番。空でないものだけ集める。
    const shelves = [];
    for (let c = 1; c < cols.length; c++) {
      const v = (cols[c] || "").trim();
      if (v !== "") shelves.push(v);
    }

    stockData.push({
      name: name,
      normName: normalize(name),
      shelves: shelves,
    });
  }
}

/* ------------------------------------------------------------------ */
/* 検索：スペース区切りの全語を含む（AND・部分一致）                    */
/* ------------------------------------------------------------------ */
function search(query) {
  const terms = normalize(query)
    .split(/\s+/)
    .filter((t) => t !== "");
  if (terms.length === 0) return [];

  return stockData.filter((item) =>
    terms.every((term) => item.normName.includes(term))
  );
}

function shelvesText(shelves) {
  return shelves.length > 0 ? shelves.join(" / ") : "（棚番未登録）";
}

/* ------------------------------------------------------------------ */
/* 画面生成：10 行。各行 ＝ ［入力＋サジェスト］ ＋ ［棚番表示エリア］ */
/* ------------------------------------------------------------------ */
function buildRows() {
  const container = document.getElementById("rows");
  for (let i = 0; i < FIELD_COUNT; i++) {
    const row = document.createElement("div");
    row.className = "row";

    // 左：入力欄＋サジェスト（ドロップダウン）
    const wrap = document.createElement("div");
    wrap.className = "input-wrap";

    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = i + 1 + "：医薬品名を入力";

    const suggest = document.createElement("ul");
    suggest.className = "suggest";
    suggest.hidden = true;

    wrap.appendChild(input);
    wrap.appendChild(suggest);

    // 右：棚番表示
    const shelf = document.createElement("div");
    shelf.className = "shelf-area empty";
    shelf.textContent = "―";

    row.appendChild(wrap);
    row.appendChild(shelf);
    container.appendChild(row);

    setupRow(input, suggest, shelf);
  }
}

function getInputs() {
  return Array.from(document.querySelectorAll("#rows input"));
}

/* サジェストを閉じる */
function hideSuggest(suggest) {
  suggest.hidden = true;
  suggest.innerHTML = "";
}

/* 候補を選択：入力欄に薬品名、右に棚番を反映 */
function selectItem(item, input, suggest, shelf) {
  input.value = item.name;
  shelf.textContent = shelvesText(item.shelves);
  shelf.classList.remove("empty");
  hideSuggest(suggest);
}

/* 入力内容から候補一覧を作り直す */
function updateSuggest(input, suggest, shelf) {
  // 入力中は右の棚番表示をいったんクリア
  shelf.textContent = "―";
  shelf.classList.add("empty");

  const query = input.value.trim();
  if (query === "") {
    hideSuggest(suggest);
    return;
  }

  const hits = search(query).slice(0, MAX_SUGGEST);
  suggest.innerHTML = "";

  if (hits.length === 0) {
    const li = document.createElement("li");
    li.className = "suggest-empty";
    li.textContent = "該当なし";
    suggest.appendChild(li);
    suggest.hidden = false;
    return;
  }

  hits.forEach((item) => {
    const li = document.createElement("li");
    li.className = "suggest-item";
    li.__item = item; // 選択時の参照用

    const nameEl = document.createElement("span");
    nameEl.className = "s-name";
    nameEl.textContent = item.name;

    const shelfEl = document.createElement("span");
    shelfEl.className = "s-shelf";
    shelfEl.textContent = shelvesText(item.shelves);

    li.appendChild(nameEl);
    li.appendChild(shelfEl);

    // mousedown＋preventDefault で blur より先に選択を確定させる
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selectItem(item, input, suggest, shelf);
    });

    suggest.appendChild(li);
  });

  suggest.hidden = false;
}

/* 1 行分のイベント設定（入力・キーボード操作・フォーカス制御） */
function setupRow(input, suggest, shelf) {
  let active = -1; // ハイライト中の候補 index（-1＝なし）

  function items() {
    return Array.from(suggest.querySelectorAll(".suggest-item"));
  }
  function setActive(i) {
    const its = items();
    its.forEach((el) => el.classList.remove("active"));
    active = i;
    if (i >= 0 && i < its.length) {
      its[i].classList.add("active");
      its[i].scrollIntoView({ block: "nearest" });
    }
  }

  input.addEventListener("input", () => {
    active = -1;
    updateSuggest(input, suggest, shelf);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim() !== "") updateSuggest(input, suggest, shelf);
  });

  input.addEventListener("blur", () => {
    hideSuggest(suggest);
  });

  input.addEventListener("keydown", (e) => {
    if (suggest.hidden) return;
    const its = items();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(active + 1, its.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === "Enter") {
      if (active >= 0 && its[active]) {
        e.preventDefault();
        selectItem(its[active].__item, input, suggest, shelf);
      }
    } else if (e.key === "Escape") {
      hideSuggest(suggest);
    }
  });
}

function clearAll() {
  getInputs().forEach((input) => (input.value = ""));
  document.querySelectorAll("#rows .shelf-area").forEach((shelf) => {
    shelf.textContent = "―";
    shelf.classList.add("empty");
  });
  document.querySelectorAll("#rows .suggest").forEach((s) => hideSuggest(s));
  const first = getInputs()[0];
  if (first) first.focus();
}

/* ------------------------------------------------------------------ */
/* 初期化                                                              */
/* ------------------------------------------------------------------ */
function init() {
  buildRows();

  const status = document.getElementById("status");
  document.getElementById("clearBtn").addEventListener("click", clearAll);

  loadStock()
    .then(() => {
      status.textContent = "在庫データ読み込み完了（" + stockData.length + "件）";
    })
    .catch((err) => {
      status.textContent = "読み込みエラー：" + err.message;
      status.classList.add("error");
    });
}

document.addEventListener("DOMContentLoaded", init);
