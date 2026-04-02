# WTT Team Match Formatter

WTT の団体戦結果を取得し、日本語向けの所定書式で書き出すための作業ディレクトリです。

## ファイル構成

- `extract_team_matches.js`
  - 結果取得、キャッシュ、絞り込み、整形を行うスクリプト
- `server.js`
  - Web MVP 用の HTTP サーバー
- `public/index.html`
  - フォーム入力と結果表示の画面
- `translations.ja.json`
  - 選手名、国名、ラウンド名の辞書
- `rules.json`
  - 見出し表記やラウンド表示などのルール設定
- `.cache/event_2751_take_200.json`
  - `eventId=2751` の結果キャッシュ

## この作業のルール

- 元データは WTT の公式結果データだけを使う
- 名前置換は `translations.ja.json` だけを使う
- 表示仕様の微修正は、まず `rules.json` で吸収できるか確認する
- 辞書にある名前は辞書表記を使う
- 辞書にない名前は元データのフルネームをそのまま使う
- 出力時は勝ったチームを左側に置く
- 各個人戦も、その左側チームの選手を左側に置く
- ゲームスコアは、並べ替え後の左側選手基準で書く
- 左側選手がそのゲームを取ったら相手得点を正数で書く
- 左側選手がそのゲームを落としたら左側選手の得点を負数で書く
- 未実施の 4 試合目、5 試合目も左側チーム基準で並べる

## 出力書式

例:

```text
▼女子グループ6 　
　香港　3-0　カザフスタン
○朱成竹　3(5,9,9)0　MIRKADIROVA Sarvinoz
○李皓晴　3(5,0,3)0　ROMANOVSKAYA Angelina
○杜凱琹　3(8,14,-8,9)1　BAKHYT Anel
　李皓晴　-　MIRKADIROVA Sarvinoz
　朱成竹　-　ROMANOVSKAYA Angelina
```

## 使い方

Web MVP 起動:

```bash
npm start
```

起動後:

```text
http://127.0.0.1:3000
```

管理トークン付きローカル確認:

```bash
npm run start:admin
```

```text
http://127.0.0.1:3001
Admin Token: secret-token
```

環境変数を使う場合:

```bash
cp .env.example .env
```

初回取得またはキャッシュ更新:

```bash
node extract_team_matches.js --event 2751 --refresh-cache --list
```

通常実行:

```bash
node extract_team_matches.js --event 2751 --gender women --contains Kazakhstan --ja
```

一覧確認:

```bash
node extract_team_matches.js --event 2751 --gender women --contains Germany --list
```

JSON 確認:

```bash
node extract_team_matches.js --event 2751 --contains "Romania 71" --json
```

## 主なオプション

- `--event`
  - WTT の `eventId`
- `--gender`
  - `men` / `women`
- `--round`
  - `quarterfinal`, `semifinal`, `final`, `round of 16`, `stage 1a`, `stage 1b`, `preliminary round` など
- `--contains`
  - チーム名、国コード、説明文を含む自由検索
- `--team`
  - チーム名や国コードでの絞り込み
- `--limit`
  - 出力件数制限
- `--list`
  - 一覧だけ出力
- `--json`
  - 正規化済み JSON を出力
- `--ja`
  - 日本語向け整形出力
- `--refresh-cache`
  - キャッシュを無視して再取得

## Web API

- `GET /api/team-matches`
  - 例: `/api/team-matches?event=2751&gender=men&round=round%20of%2032&contains=Austria&format=ja`
- `format`
  - `ja` / `list` / `text` / `json`
- `GET /api/health`
  - ヘルスチェック用
- `GET /api/config/translations`
  - 辞書 JSON の読込
- `PUT /api/config/translations`
  - 辞書 JSON の保存
- `GET /api/config/rules`
  - ルール JSON の読込
- `PUT /api/config/rules`
  - ルール JSON の保存

## 公開運用メモ

- 検索 API は公開して問題ない前提
- 辞書・ルール編集 API は `ADMIN_TOKEN` で保護できる
- 管理画面で辞書やルールを読む/保存するときは、画面上の `Admin Token` 欄に同じ値を入れる
- `translations.ja.json` と `rules.json` を書き換えるので、公開先は永続ストレージ前提
- 本番では `DATA_DIR` 配下に `translations.ja.json` / `rules.json` / `.cache/` を置く
- Vercel のような書き込みが永続化されないサーバーレス構成には、そのままでは不向き
- Docker で動かす場合は `Dockerfile` を利用できる
- 永続ディスクを付けられる Render / Railway / Fly.io / VPS 系と相性がよい

Docker 起動例:

```bash
docker build -t ttreport .
docker run --rm -p 3000:3000 -e ADMIN_TOKEN=change-me -e DATA_DIR=/data -v $(pwd)/data:/data ttreport
```

Render で公開する場合:

```text
1. GitHub に push
2. Render で Blueprint を作成
3. このリポジトリの render.yaml を使う
4. ADMIN_TOKEN だけ Render 側で設定
```

Render 用の設定ファイル:

- `render.yaml`
  - Docker 起動
  - `/var/data` を永続ディスクとしてマウント
  - `DATA_DIR=/var/data` を設定
- Render 公開の具体手順は `DEPLOY_RENDER.md` を参照

GitHub に置く前の注意:

- `deploy_data_test/` や `data/` のようなローカル検証用ディレクトリは commit しない
- `.env` は commit しない
- 本番用 `ADMIN_TOKEN` は Render 側の環境変数で設定する

## キャッシュについて

- `eventId=2751` は `.cache/event_2751_take_200.json` に保存済み
- このファイルがあれば、同じ大会はネットワークなしでも再整形できる
- 別の大会を扱うときは `--event <id> --refresh-cache` で取得する
- ロンドン 2026 のような `Stage 1A / Stage 1B / Preliminary Round / Main Draw` 形式も、結果 API にデータが出れば同じスクリプトで扱える

## 別PCへ引き継ぐ方法

最低限、次の 3 つを持っていけば作業を継続できます。

- `extract_team_matches.js`
- `translations.ja.json`
- `.cache/`

一番確実なのは、このディレクトリ全体をそのままコピーすることです。
