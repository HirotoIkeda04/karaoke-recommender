# スクレイパ詳細設計書

カラオケ推薦アプリ フェーズ1 のデータ収集スクリプトの仕様書。
Claude Code でローカル環境で実行する前提で記述する。

---

## 1. 目的

有名曲200〜500曲について、以下の情報を1つの JSON/CSV に統合する:

- 曲名・アーティスト名・リリース年
- 音域(地声最低・地声最高・裏声最高)をMIDI番号で
- Spotify track ID
- ジャケット画像URL(3サイズ)

---

## 2. データソース

### 2.1 主データソース: カラ音 (karaoto.net)

**URL構造**
```
https://karaoto.net/max_key/{N}
```

N の対応表:

| N | 最高音 | MIDI |
|---|-------|------|
| 31 | mid2E | 64 |
| 32 | mid2F | 65 |
| 33 | mid2F# | 66 |
| 34 | mid2G | 67 |
| 35 | mid2G# | 68 |
| 36 | hiA | 69 |
| 37 | hiA# | 70 |
| 38 | hiB | 71 |
| 39 | hiC | 72 |
| 40 | hiC# | 73 |
| 41 | hiD | 74 |
| 42 | hiD# | 75 |
| 43 | hiE | 76 |
| 44 | hiF | 77 |

**HTML構造(Markdown換算)**

```
## アーティスト名
曲名(bold or plain)
地声：{最低音}～{最高音}
裏高：{最高音}   または   裏声：-
発売日:{YYYY/MM/DD}   (任意)
収録アルバム『{xxx}』  (任意)
ドラマ『{xxx}』主題歌  (任意)
```

- `##` でアーティストを区切る
- 曲名は `<strong>` タグで囲まれる場合があり、その曲は「代表曲」扱い
- 音域行は**必ず「地声：」で始まる**
- 裏声の行は `裏高：` か `裏声：-` のどちらか

**パース正規表現**

```regex
地声：(?P<low>[^～〜~]+)?[～〜~](?P<high>[^\s]+)
裏高：(?P<falsetto>[^\s]+)
裏声：-
発売日:(?P<date>\d{4}/\d{2}/\d{2})
収録アルバム『(?P<album>[^』]+)』
```

- `地声：～mid2G` のように低音が省略される場合がある → `low` は NULL を許容
- `～` の文字は全角(U+FF5E)と半角(U+007E)と別種(U+301C)がある。正規化が必要

### 2.2 補完データソース: カラオケ音域調査 (onikichosa.com)

カラ音でカバーできない新曲(Vaundy、Ado、近年米津等)の補完用。
具体的なHTML構造は Claude Code 実装時に別途確認する。

### 2.3 Spotify Web API

**エンドポイント**
```
GET https://api.spotify.com/v1/search?q={query}&type=track&market=JP&limit=5
```

クエリ形式: `track:{曲名} artist:{アーティスト名}`

**認証**: Client Credentials フロー(ユーザー認証不要)
- Client ID / Secret を Spotify Developer Dashboard で取得
- `.env` に格納

**取得する情報**
```json
{
  "tracks": {
    "items": [{
      "id": "spotify_track_id",
      "name": "曲名",
      "artists": [{"name": "アーティスト"}],
      "album": {
        "release_date": "2018-03-14",
        "images": [
          {"url": "...", "height": 640, "width": 640},
          {"url": "...", "height": 300, "width": 300},
          {"url": "...", "height": 64, "width": 64}
        ]
      }
    }]
  }
}
```

---

## 3. 事前確認事項(実行前必須)

### 3.1 robots.txt

実行前に以下を確認:

- `https://karaoto.net/robots.txt`
- `https://onikichosa.com/robots.txt`

`Disallow: /` が含まれていたら**スクレイピング中止**。

### 3.2 利用規約

各サイトのフッターから利用規約ページを確認。商用利用禁止の場合は個人利用範囲での使用に留める。

### 3.3 連絡用 User-Agent

```
User-Agent: KaraokeRecommenderBot/0.1 (contact: {Hirotoさんの連絡先}; research/personal)
```

サイト運営者が問い合わせできる形にする。

---

## 4. スクレイピング仕様

### 4.1 リクエスト制御

- **間隔**: 最低 2秒 (`time.sleep(2)`)
- **タイムアウト**: 30秒
- **リトライ**: 最大3回、指数バックオフ(2秒 → 4秒 → 8秒)
- **並列度**: 1 (並列化しない)
- **実行時間帯**: 深夜2時〜朝6時は避ける(サーバ負荷軽減の慣習)

### 4.2 キャッシュ

取得した HTML を**ローカルにファイル保存**し、二度引きしない。

```
./cache/
  karaoto/
    max_key_34.html
    max_key_35.html
    ...
  onikichosa/
    ...
```

### 4.3 ログ

各リクエストを以下の形式でログ記録:

```
2026-04-23T14:32:01 GET https://karaoto.net/max_key/34 → 200 (45,231 bytes) [2.3s]
2026-04-23T14:32:03 GET https://karaoto.net/max_key/35 → 200 (52,100 bytes) [1.8s]
```

---

## 5. MIDI変換仕様

### 5.1 変換テーブル

**重要**: karaoto表記の「octave境界は A」である点に注意。mid2G の次は hiA で、C基準ではない。

```python
# 基準: hiA = A4 = MIDI 69
# オクターブは A→G#

NOTE_TABLE = {
    # lowlow 範囲 (A0 - G#1)
    'lowlowA': 21, 'lowlowA#': 22, 'lowlowB': 23,
    'lowlowC': 24, 'lowlowC#': 25, 'lowlowD': 26, 'lowlowD#': 27,
    'lowlowE': 28, 'lowlowF': 29, 'lowlowF#': 30, 'lowlowG': 31, 'lowlowG#': 32,

    # low 範囲 (A1 - G#2)
    'lowA': 33, 'lowA#': 34, 'lowB': 35,
    'lowC': 36, 'lowC#': 37, 'lowD': 38, 'lowD#': 39,
    'lowE': 40, 'lowF': 41, 'lowF#': 42, 'lowG': 43, 'lowG#': 44,

    # mid1 範囲 (A2 - G#3)
    'mid1A': 45, 'mid1A#': 46, 'mid1B': 47,
    'mid1C': 48, 'mid1C#': 49, 'mid1D': 50, 'mid1D#': 51,
    'mid1E': 52, 'mid1F': 53, 'mid1F#': 54, 'mid1G': 55, 'mid1G#': 56,

    # mid2 範囲 (A3 - G#4)
    'mid2A': 57, 'mid2A#': 58, 'mid2B': 59,
    'mid2C': 60, 'mid2C#': 61, 'mid2D': 62, 'mid2D#': 63,
    'mid2E': 64, 'mid2F': 65, 'mid2F#': 66, 'mid2G': 67, 'mid2G#': 68,

    # hi 範囲 (A4 - G#5)
    'hiA': 69, 'hiA#': 70, 'hiB': 71,
    'hiC': 72, 'hiC#': 73, 'hiD': 74, 'hiD#': 75,
    'hiE': 76, 'hiF': 77, 'hiF#': 78, 'hiG': 79, 'hiG#': 80,

    # hihi 範囲 (A5 - G#6)
    'hihiA': 81, 'hihiA#': 82, 'hihiB': 83,
    'hihiC': 84, 'hihiC#': 85, 'hihiD': 86, 'hihiD#': 87,
    'hihiE': 88, 'hihiF': 89, 'hihiF#': 90, 'hihiG': 91, 'hihiG#': 92,
}
```

### 5.2 表記揺れの正規化

スクレイピング時に以下を置換:
- `♯` → `#`
- `♭` → `b` (DBには MIDI で持つので実質不要)
- 全角英字 → 半角英字

### 5.3 逆変換(表示用)

DBでは MIDI 番号で持ち、UI表示時に逆変換する。TypeScriptで実装:

```typescript
export function midiToKaraokeNotation(midi: number): string {
  const table = {
    // 上記の逆テーブル
  };
  return table[midi] ?? 'unknown';
}
```

---

## 6. 楽曲マッチング(Spotify連携)

### 6.1 検索戦略(段階的フォールバック)

1. **厳密マッチ**: `track:{title} artist:{artist}` で検索、results[0] を採用
2. **緩和マッチ(1)**: 記号を除去してリトライ
   - 例: 「Lemon」のカッコ書きや記号を除去
3. **緩和マッチ(2)**: アーティスト名のみで検索し、曲名の類似度が閾値以上のものを採用
4. **全敗時**: スキップし、`unmatched.csv` に出力して手動確認

### 6.2 表記揺れパターン

| カラ音表記 | Spotify表記 |
|-----------|-------------|
| `アップルパイ` | `アップルパイ` or `apple pie` |
| `Lemon` | `Lemon` |
| `3月9日` | `3月9日` |
| `ひまわりの約束` | `ひまわりの約束 ()` のようにサブタイトルが付く場合あり |
| `One Ok Rock` | `ONE OK ROCK` |
| `B'z` | `B'z` or `Bz` |

**対策**:
- 大文字小文字を無視
- 全角/半角の統一
- カッコ内(`()`, `[]`, `〜`)の内容を除去して比較
- アーティスト名の表記揺れ辞書を別途メンテナンス(後述)

### 6.3 アーティスト名正規化辞書

`artist_alias.json` として別管理:

```json
{
  "ONE OK ROCK": ["One Ok Rock", "ワンオク", "OneOkRock"],
  "SEKAI NO OWARI": ["Sekai No Owari", "セカオワ", "末世"],
  "Mr.Children": ["Mr.Children", "ミスチル", "MrChildren"],
  "B'z": ["B'z", "Bz"],
  "米津玄師": ["Kenshi Yonezu", "米津玄師"]
}
```

検索時、登録されたエイリアスを順にトライ。

### 6.4 類似度計算(Levenshtein 距離の正規化版)

```python
def similarity(a: str, b: str) -> float:
    """0.0〜1.0で返す。1.0が完全一致。"""
    distance = levenshtein(normalize(a), normalize(b))
    max_len = max(len(a), len(b))
    return 1 - (distance / max_len) if max_len > 0 else 1.0
```

閾値 0.85 以上を採用。それ以下は `unmatched.csv` へ。

---

## 7. 出力形式

### 7.1 メイン出力: `songs_seed.json`

```json
{
  "songs": [
    {
      "title": "Lemon",
      "artist": "米津玄師",
      "release_year": 2018,
      "range_low_midi": 53,
      "range_high_midi": 67,
      "falsetto_max_midi": 72,
      "spotify_track_id": "0WqIKmW4BTrj3eJFmnCKMv",
      "image_url_large": "https://i.scdn.co/image/.../640.jpg",
      "image_url_medium": "https://i.scdn.co/image/.../300.jpg",
      "image_url_small": "https://i.scdn.co/image/.../64.jpg",
      "source_urls": [
        "https://karaoto.net/max_key/34",
        "https://api.spotify.com/v1/tracks/0WqIKmW4BTrj3eJFmnCKMv"
      ]
    }
  ],
  "metadata": {
    "scraped_at": "2026-04-23T14:00:00Z",
    "total_count": 287,
    "sources": ["karaoto.net", "spotify"]
  }
}
```

### 7.2 エラーレポート: `unmatched.csv`

Spotifyでヒットしなかった曲の一覧。手動で確認して補正用。

```csv
title,artist,karaoto_url,reason
◯◯,ヨルシカ,https://karaoto.net/max_key/38,no_spotify_result
△△,aiko,https://karaoto.net/max_key/36,low_similarity_0.72
```

### 7.3 統計ログ: `scraping_report.md`

```markdown
# スクレイピングレポート 2026-04-23

## 取得結果
- カラ音: 14ページ / 3,247曲 取得
- Spotify マッチ成功: 2,891曲 (89.0%)
- 未マッチ: 356曲(unmatched.csv)

## エラー
- HTTP 5xx: 3回 (リトライ成功)
- パース失敗: 0件

## 所要時間
- 合計: 38分
```

---

## 8. 実装モジュール構成

```
scraper/
├── .env                       # API keys
├── config.py                  # 定数、閾値、URL設定
├── note_converter.py          # MIDI変換ロジック
├── artist_alias.json          # アーティスト名辞書
├── cache/                     # HTML キャッシュ
├── output/                    # 最終成果物
│   ├── songs_seed.json
│   ├── unmatched.csv
│   └── scraping_report.md
├── src/
│   ├── scrape_karaoto.py      # カラ音スクレイパ
│   ├── scrape_onikichosa.py   # onikichosa スクレイパ(補完)
│   ├── fetch_spotify.py       # Spotify API クライアント
│   ├── matcher.py             # 楽曲マッチング
│   └── main.py                # オーケストレーション
└── tests/
    ├── test_note_converter.py
    ├── test_parser.py
    └── fixtures/              # 実HTMLのサンプル
```

---

## 9. 実行フロー

```
[Step 1] カラ音 14ページをクロール → ./cache/karaoto/
[Step 2] キャッシュからパース → songs_raw.json (曲名・アーティスト・音域のみ)
[Step 3] Spotify Search で各曲を検索 → track_id, 画像, リリース年を取得
[Step 4] マッチ失敗曲を onikichosa でリトライ(オプション)
[Step 5] 結果統合 → songs_seed.json
[Step 6] Supabase の songs テーブルへ投入(SQL または Supabase CLI)
```

**所要時間の見積**:
- Step 1: 14ページ × 3秒 = 約1分
- Step 2: 数秒
- Step 3: 3000曲 × 0.5秒 = 約25分(Spotify APIはレート制限ゆるめ)
- Step 4〜5: 数分
- **合計: 30〜40分**

初回は Step 1 と Step 3 をそれぞれ確認しながら実行し、問題なければ一気通貫で実行。

---

## 10. テスト戦略

### 10.1 ユニットテスト(必須)

- `note_converter.py`: 全 MIDI 番号 ↔ 表記の双方向変換
- `parser.py`: 実HTMLサンプルからのパース(fixtures を使用)

### 10.2 統合テスト

- Spotify API をモック化し、マッチングロジック全体を通す
- 表記揺れのあるサンプル10曲を用意して全マッチ成功を確認

### 10.3 サンプリング検証(手動)

- 最終出力から20曲ランダム抽出
- 音域データが実際のカラ音ページと一致するか目視確認
- Spotifyで再生してジャケ画像と楽曲が一致するか確認

---

## 11. 受け入れ基準

以下を満たせば完了:

- [ ] カラ音から1000曲以上の音域データを取得
- [ ] Spotify マッチ率 85% 以上
- [ ] `songs_seed.json` が Supabase へ投入可能な形式
- [ ] `unmatched.csv` は手動補正可能な形式
- [ ] スクレイピング中サーバー側にエラーを起こしていない(HTTP 4xx/5xx がリトライ後0件)
- [ ] 実行時間 1時間以内

---

## 12. Claude Code への依頼文(テンプレート)

実装時に Claude Code に渡す最小プロンプト例:

```
本プロジェクトはカラオケ推薦アプリのフェーズ1で使用する楽曲マスタを構築する
データ収集スクリプトです。添付の scraper_design_spec.md に従って実装してください。

環境: Python 3.11 / macOS
依存: requests, beautifulsoup4, python-dotenv, rapidfuzz (類似度計算用)

優先順位:
1. note_converter.py とそのテスト
2. scrape_karaoto.py (1ページ分のパーサを先に完成)
3. fetch_spotify.py (認証とsearch)
4. matcher.py (マッチングロジック)
5. main.py で全体結合

各ステップで動作確認してから次へ進めてください。
実装中に仕様書の不明点があれば質問してください。
```

---

## 13. 残論点

実装着手前に決める必要があるもの:

1. **onikichosa のスクレイピングをやるか**
   - カラ音だけで十分なカバレッジが得られれば省略
   - MVP フェーズ1 は「カラ音のみ」で行くのが現実的

2. **実行頻度**
   - 1回だけ実行してJSON固定、とする
   - 月次で再実行して差分更新、とする
   - → MVPは「1回限り」で十分

3. **カラオケランキング(DAM/JOYSOUND)との統合**
   - カラ音は音域でソートされているが、人気順ではない
   - 有名曲の絞り込みをどう行うか(太字の「代表曲」のみ採用する案)
   - → カラ音の `<strong>` で囲まれた曲を「代表曲」としてフラグ付け、フェーズ1ではまず全曲取得・表示時に代表曲を優先、で進める

---

以上。このスペックを元に Claude Code へ実装依頼すれば、2〜4時間でデータ取得スクリプトが完成する見込み。
