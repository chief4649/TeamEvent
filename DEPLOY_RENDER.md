# Render 公開手順

このアプリは `translations.ja.json` と `rules.json` を更新するため、永続ディスク付きの公開先が必要です。
ここでは Render を使う想定でまとめます。

## 事前準備

必要なもの:

- GitHub アカウント
- Render アカウント
- このディレクトリ一式

## 1. GitHub に置く

このディレクトリを GitHub リポジトリに push します。

commit しないもの:

- `.env`
- `deploy_data_test/`
- `data/`

最低限含めるもの:

- `extract_team_matches.js`
- `server.js`
- `public/`
- `translations.ja.json`
- `rules.json`
- `.cache/`
- `Dockerfile`
- `render.yaml`

## 2. Render で新規作成

1. Render にログイン
2. `New +` を押す
3. `Blueprint` を選ぶ
4. GitHub リポジトリを接続
5. `render.yaml` を読み込ませる

これで Web Service と永続ディスクの設定が自動で入ります。

## 3. 環境変数を入れる

Render の管理画面で `ADMIN_TOKEN` を設定します。

例:

```text
ADMIN_TOKEN=長くて推測されにくい文字列
```

これは辞書・ルール編集用の管理トークンです。

## 4. デプロイ完了後の確認

公開 URL を開いて確認します。

確認ポイント:

1. トップ画面が開く
2. 試合検索が動く
3. `Admin Token` 欄に `ADMIN_TOKEN` と同じ値を入れる
4. `Translations JSON` の `Load` が動く
5. 一括追加して `Save` が動く

## 5. 運用の考え方

- 検索だけ使う人は `Admin Token` 不要
- 辞書やルールを触る人だけ `Admin Token` を知っていればよい
- 辞書とルールは永続ディスクに保存される

## トラブル時

### 画面は開くが編集できない

- `Admin Token` 欄に正しい値を入れているか確認
- Render の `ADMIN_TOKEN` 設定と一致しているか確認

### デプロイは通るが辞書変更が消える

- 永続ディスクが付いているか確認
- `DATA_DIR=/var/data` が入っているか確認

### 検索結果が 0 件

- 大会前で結果 API がまだ空の可能性があります
- `eventId` と `gender` と `round` を確認してください
