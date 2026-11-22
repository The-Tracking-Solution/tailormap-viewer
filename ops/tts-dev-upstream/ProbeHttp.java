import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** Anonymous, read-only readiness request inside the temporary API container. */
public class ProbeHttp {
  public static void main(String[] args) throws Exception {
    var client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:18086/api/user"))
        .timeout(Duration.ofSeconds(5)).GET().build();
    for (int attempt=0;attempt<90;attempt++) {
      try {
        var response=client.send(request,HttpResponse.BodyHandlers.ofString());
        if (response.statusCode()==200 && response.body().matches("(?s).*\\\"authenticated\\\"\\s*:\\s*false.*")) {
          System.out.println("PROBE_HTTP_OK");return;
        }
      } catch (java.io.IOException ignored) { }
      Thread.sleep(2000);
    }
    throw new IllegalStateException("Anonymous /api/user readiness check failed");
  }
}
