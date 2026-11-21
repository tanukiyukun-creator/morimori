import Foundation

struct LocationPayload: Encodable {
    let userId: String
    let latitude: Double
    let longitude: Double
}

final class NativeAPI {
    static let shared = NativeAPI()

    // Renderへ公開したmorimoriサーバーのURLに変更してください。
    var baseURL = "https://camview-1sff.onrender.com"

    private init() {}

    func sendLocation(userId: String, latitude: Double, longitude: Double) async throws {
        guard let url = URL(string: "\(baseURL)/api/location/update") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15

        request.httpBody = try JSONEncoder().encode(
            LocationPayload(
                userId: userId,
                latitude: latitude,
                longitude: longitude
            )
        )

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}
