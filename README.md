# morimori v0.1.1

学校向けリアルタイム連絡アプリのMVPです。

## Render

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`

RenderのWeb Serviceでは、サーバーを `0.0.0.0` の `PORT` で待ち受ける必要があります。この版では対応済みです。

## 現在の機能

- 名前＋クラスで開始
- ユーザー一覧
- オンライン状態
- リアルタイム1対1チャット
- 日本語IME対応
- Enterによる送信とIME変換確定の区別
- Shift+Enter改行
- 返信
- 既読
- 返信通知
- PWA基本設定

## 注意

この版ではユーザー・メッセージをサーバーのメモリに保持しています。
Renderの再起動・スリープ等でデータは消えます。

本番版ではDB、端末引き継ぎ、認証、ファイル保存、Push通知、WebRTC通話などを追加します。