import SwiftUI
import CoreLocation

struct ContentView: View {
    @EnvironmentObject private var locationManager: LocationManager

    @AppStorage("morimori-user-id") private var userId = ""
    @AppStorage("morimori-user-name") private var userName = ""
    @AppStorage("morimori-user-class") private var userClass = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("morimori") {
                    Text("iPadネイティブ版")
                        .font(.title2.bold())

                    Text("画面を消している間も、iPadOSが許可する範囲で位置情報共有を継続します。")
                        .foregroundStyle(.secondary)
                }

                Section("アカウント") {
                    TextField("ユーザーID", text: $userId)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    TextField("表示名", text: $userName)
                    TextField("クラス", text: $userClass)
                }

                Section("位置情報共有") {
                    HStack {
                        Text("状態")
                        Spacer()
                        Text(locationManager.isSharing ? "共有中" : "停止")
                            .foregroundStyle(locationManager.isSharing ? .green : .secondary)
                    }

                    Button {
                        locationManager.configure(
                            userId: userId.trimmingCharacters(in: .whitespacesAndNewlines)
                        )

                        if locationManager.isSharing {
                            locationManager.stopSharing()
                        } else {
                            locationManager.startSharing()
                        }
                    } label: {
                        Text(locationManager.isSharing ? "位置情報共有を停止" : "位置情報共有を開始")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(userId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    if let lastUpdate = locationManager.lastUpdate {
                        Text("最終更新: \(lastUpdate.formatted(date: .omitted, time: .shortened))")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    if let error = locationManager.lastError {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                Section("iPadOSの許可") {
                    Text("画面OFF中も位置情報を共有するには、iPadOSの位置情報設定でmorimoriに「常に」を許可し、位置情報共有をONにしてください。")
                        .font(.footnote)
                }
            }
            .navigationTitle("morimori")
            .onAppear {
                locationManager.configure(
                    userId: userId.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            }
        }
    }
}
