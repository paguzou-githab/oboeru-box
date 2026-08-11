#!/usr/bin/env node
/* =====================================================
   おぼえるBOX デッキ検査スクリプト
   仕様書「おぼえるBOX_解説埋め込み仕様.md」5. 品質チェック に対応

   使い方:
     node validate_deck.js decks/eiken200.json
     node validate_deck.js decks/eiken200.json 元のeiken200.json
       ← 第2引数を渡すと term / meaning / reading の改変チェックも行う
   ===================================================== */
'use strict';
const fs = require('fs');

const DETAIL_KEYS = ['ipa', 'phonics', 'core', 'usage', 'example', 'confuse'];
const REQUIRED = ['term', 'meaning', 'core', 'usage', 'example'];
/* 熟語・文法項目は ipa / phonics を空にしてよい。
   term に空白・〜・( ) を含むものを熟語とみなす。 */
function isPhrase(term) {
  return /[\s〜～~()（）]/.test(String(term));
}

const errors = [];
const warns = [];
function err(i, term, msg) { errors.push(`  [${String(i + 1).padStart(3)}] ${term} … ${msg}`); }
function warn(i, term, msg) { warns.push(`  [${String(i + 1).padStart(3)}] ${term} … ${msg}`); }

function readJson(path) {
  let raw;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (e) {
    console.error(`✗ ファイルを読めません: ${path}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`✗ JSONのパースに失敗: ${path}\n  ${e.message}`);
    process.exit(1);
  }
}

const targetPath = process.argv[2];
const basePath = process.argv[3];
if (!targetPath) {
  console.error('使い方: node validate_deck.js <デッキJSON> [元のデッキJSON]');
  process.exit(1);
}

const items = readJson(targetPath);
if (!Array.isArray(items)) {
  console.error('✗ トップレベルが配列ではありません');
  process.exit(1);
}

/* ---------- 1件ずつ検査 ---------- */
const stats = { phrase: 0, word: 0 };
DETAIL_KEYS.forEach(k => { stats[k] = 0; });

items.forEach((it, i) => {
  const term = it && it.term ? String(it.term) : '(term無し)';

  if (!it || typeof it !== 'object' || Array.isArray(it)) {
    err(i, term, 'オブジェクトではありません');
    return;
  }

  const phrase = isPhrase(it.term);
  phrase ? stats.phrase++ : stats.word++;

  /* 必須フィールドの欠落・空文字 */
  REQUIRED.forEach(k => {
    if (typeof it[k] !== 'string' || it[k].trim() === '') {
      err(i, term, `${k} が未設定または空`);
    }
  });

  /* 単語は ipa 必須。熟語・文法項目は ipa / phonics を空にする */
  if (!phrase) {
    if (typeof it.ipa !== 'string' || it.ipa.trim() === '') {
      err(i, term, 'ipa が未設定または空（単語は必須）');
    }
  } else {
    if (it.ipa && String(it.ipa).trim() !== '') {
      err(i, term, 'ipa は熟語・文法項目では空文字にする');
    }
    if (it.phonics && String(it.phonics).trim() !== '') {
      err(i, term, 'phonics は熟語・文法項目では空文字にする');
    }
  }

  /* ipa にスラッシュを含めない */
  if (typeof it.ipa === 'string' && it.ipa.includes('/')) {
    err(i, term, `ipa にスラッシュが混入: ${it.ipa}`);
  }

  /* example は「英文｜和訳」。全角パイプをちょうど1つ含む */
  if (typeof it.example === 'string' && it.example.trim() !== '') {
    const bars = (it.example.match(/｜/g) || []).length;
    if (bars !== 1) {
      err(i, term, `example の全角｜が ${bars} 個（1個にする）`);
    } else {
      const [en, ja] = it.example.split('｜');
      if (!en.trim()) err(i, term, 'example の英文が空');
      if (!ja.trim()) err(i, term, 'example の和訳が空');
      const words = en.trim().split(/\s+/).length;
      if (words > 8) warn(i, term, `example の英文が ${words} 語（目安8語以内）`);
    }
    if (it.example.includes('|')) {
      err(i, term, 'example に半角パイプ | が混入（全角｜にする）');
    }
  }

  /* 共通の書式ルール: 改行禁止・ダブルクォート禁止 */
  DETAIL_KEYS.forEach(k => {
    const v = it[k];
    if (typeof v !== 'string') {
      if (v !== undefined) err(i, term, `${k} が文字列ではありません`);
      return;
    }
    if (v.trim() !== '') stats[k]++;
    if (/[\r\n]/.test(v)) err(i, term, `${k} に改行が含まれています`);
    if (v.includes('"')) err(i, term, `${k} にダブルクォートが含まれています`);
    if (v !== v.trim()) warn(i, term, `${k} の前後に余分な空白`);
  });

  /* 文字数の目安（超過は警告どまり） */
  const len = k => (typeof it[k] === 'string' ? Array.from(it[k]).length : 0);
  if (len('core') && (len('core') < 30 || len('core') > 90)) {
    warn(i, term, `core が ${len('core')} 字（目安40〜70字）`);
  }
  if (len('usage') && (len('usage') < 20 || len('usage') > 80)) {
    warn(i, term, `usage が ${len('usage')} 字（目安30〜60字）`);
  }
  if (len('confuse') && (len('confuse') < 30 || len('confuse') > 100)) {
    warn(i, term, `confuse が ${len('confuse')} 字（目安40〜80字）`);
  }

  /* phonics の書式: 「綴り → 読み方」 */
  if (typeof it.phonics === 'string' && it.phonics.trim() !== '' && !it.phonics.includes('→')) {
    warn(i, term, 'phonics に → がありません（綴り → 読み方 の形式）');
  }
});

/* ---------- term の重複 ---------- */
const seen = new Map();
items.forEach((it, i) => {
  if (!it || !it.term) return;
  const t = String(it.term);
  if (seen.has(t)) errors.push(`  [${String(i + 1).padStart(3)}] ${t} … term が重複（${seen.get(t) + 1}件目と同じ）`);
  else seen.set(t, i);
});

/* ---------- 元ファイルとの照合 ---------- */
if (basePath) {
  const base = readJson(basePath);
  if (!Array.isArray(base)) {
    console.error('✗ 元ファイルのトップレベルが配列ではありません');
    process.exit(1);
  }
  if (base.length !== items.length) {
    errors.push(`  件数が変わっています: 元 ${base.length} → 現 ${items.length}`);
  }
  const n = Math.min(base.length, items.length);
  for (let i = 0; i < n; i++) {
    ['term', 'meaning', 'reading'].forEach(k => {
      const b = base[i] && base[i][k] !== undefined ? String(base[i][k]) : '';
      const c = items[i] && items[i][k] !== undefined ? String(items[i][k]) : '';
      if (b !== c) {
        errors.push(`  [${String(i + 1).padStart(3)}] ${k} が改変されています\n        元: ${b}\n        現: ${c}`);
      }
    });
  }
}

/* ---------- 結果表示 ---------- */
console.log(`\n📦 ${targetPath}`);
console.log(`   ${items.length} 項目（単語 ${stats.word} / 熟語・文法 ${stats.phrase}）`);
console.log('   フィールド充足数:');
DETAIL_KEYS.forEach(k => {
  const pct = ((stats[k] / items.length) * 100).toFixed(0);
  console.log(`     ${k.padEnd(8)} ${String(stats[k]).padStart(3)} / ${items.length}  (${pct}%)`);
});
if (basePath) console.log(`   照合元: ${basePath}`);

/* confuse は英語250項目の合計で30〜50件が目安。
   1ファイル単位では機械判定せず、件数を出すだけにする。 */
console.log(`\n💡 confuse ${stats.confuse} 件（英語250項目の合計で30〜50件が目安）`);

if (warns.length) {
  console.log(`\n⚠️  警告 ${warns.length} 件`);
  warns.forEach(w => console.log(w));
}
if (errors.length) {
  console.log(`\n❌ エラー ${errors.length} 件`);
  errors.forEach(e => console.log(e));
  console.log('');
  process.exit(1);
}
console.log(`\n✅ エラーなし${warns.length ? `（警告 ${warns.length} 件）` : ''}\n`);
