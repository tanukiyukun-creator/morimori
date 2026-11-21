# morimori iPadネイティブ版

既存のmorimoriサーバーへ接続するiPadOS用SwiftUIアプリです。

## できること

- iPadの位置情報権限を明示的に取得
- 「位置情報共有」をユーザー自身がON/OFF
- Core Locationのバックグラウンド位置情報更新
- 取得した位置をmorimoriサーバーへ送信
- 画面OFF・スリープ中も、iPadOSが許可する範囲で位置情報更新を継続

## Xcodeでの設定

1. Xcodeで新しいiOS App / SwiftUIプロジェクトを作成し、iPad対応にする。
2. このフォルダのSwiftファイルをプロジェクトへ追加する。
3. NativeAPI.swiftのbaseURLを実際のmorimori Render URLへ変更する。
4. Target > Signing & Capabilities > Background Modesを追加する。
5. Background ModesでLocation updatesをONにする。
6. Info.plistに以下を追加する。
   - NSLocationWhenInUseUsageDescription
   - NSLocationAlwaysAndWhenInUseUsageDescription
7. 実機iPadへインストールして位置情報権限を許可する。
8. morimoriの「位置情報共有を開始」をONにする。
9. iPadの電源ボタンを1回押して画面をOFFにし、位置情報更新が続くことを確認する。

## 注意

- iPadの電源を完全にOFFにした場合は位置情報を取得できません。
- ユーザーが位置情報権限を拒否・取り消した場合は取得できません。
- iPadOSがアプリを強制終了した場合など、OSの都合でバックグラウンド更新が止まる場合があります。
- カメラを画面OFF中に起動する機能は実装していません。
- 位置情報共有はユーザーが明示的にONにした場合だけ行います。

## サーバー側

既存morimoriサーバーに以下を追加済みです。

- POST /api/location/update
- GET /api/location/latest/:userId

位置情報はusersテーブルに最新値を保存します。
谷利優樹のアカウントだけが最新位置を取得できる設計です。
