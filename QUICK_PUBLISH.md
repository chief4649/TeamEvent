# 最短公開手順

いちばん手間が少ない想定です。

## 1. GitHub に新規リポジトリを作る

GitHub で:

1. `New repository`
2. Repository name を決める
3. `Create repository`

## 2. このフォルダの中身を GitHub に上げる

ローカルの `git` を使わず、GitHub の Web 画面からまとめてアップロードする想定です。

アップロードするもの:

- `.cache/`
- `.dockerignore`
- `.env.example`
- `.gitignore`
- `DEPLOY_RENDER.md`
- `Dockerfile`
- `QUICK_PUBLISH.md`
- `README.md`
- `extract_team_matches.js`
- `package.json`
- `public/`
- `render.yaml`
- `rules.json`
- `server.js`
- `translations.ja.json`

アップロードしないもの:

- `.env`
- `data/`
- `deploy_data_test/`
- `node_modules/`

## 3. Render で公開する

1. Render にログイン
2. `New +`
3. `Blueprint`
4. さっき作った GitHub リポジトリを選ぶ
5. `Apply`

## 4. Render で `ADMIN_TOKEN` だけ入れる

例:

```text
ADMIN_TOKEN=じゅうぶん長い文字列
```

## 5. 公開後の確認

1. 公開 URL を開く
2. 試合検索が動く
3. 辞書編集したいときだけ `Admin Token` 欄に `ADMIN_TOKEN` を入れる

## 迷ったら

- Render の設定は `render.yaml` に寄せてあります
- 詳しい説明は `DEPLOY_RENDER.md`
- ローカル確認は `README.md`
