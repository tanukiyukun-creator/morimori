# SCHOOL LINK v0.1

実際のリアルタイム1対1チャットを確認するための最初のMVPです。

## 含まれるもの

- Android / iPhone / iPad / Windows / Mac / Chromebook向けレスポンシブWeb UI
- 名前・クラスだけの初回登録
- サーバー側ユーザー管理
- 1対1リアルタイムメッセージ
- 日本語IME対応（composition中のEnter誤送信を防止）
- 返信
- 既読
- オンライン状態
- ブラウザ返信通知
- PWA manifest / service worker
- ダークグレー + シアンのUI

## 起動

Node.jsをインストールした環境で:

```bash
npm install
npm start
```

ブラウザで:

http://localhost:3000

同じPCなら別ブラウザ/シークレットウィンドウで2人分のユーザーを作ると、リアルタイム通信を確認できます。

## 注意

これはv0.1のMVPです。まだ本番運用向けの認証・DB永続化・画像/ファイルストレージ・Web Push・グループ・掲示板・WebRTC通話・本格的なアカウント引き継ぎは未実装です。

次の段階ではDBを追加して、サーバー再起動後もユーザー・メッセージを保持できる構成にします。
