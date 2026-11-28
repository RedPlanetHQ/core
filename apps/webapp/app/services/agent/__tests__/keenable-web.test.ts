import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keenableGetContents, keenableWebSearch } from "~/services/agent/explorers/keenable-web";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("keenableWebSearch", () => {
  it("posts the query with the key and formats results like the Exa path", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          { title: "React hooks", url: "https://react.dev/hooks", snippet: "Hooks let you" },
          { title: "", url: "https://example.com", description: "Fallback text" },
          { title: "No URL" },
        ],
      })
    );

    const text = await keenableWebSearch("kn-test", "react hooks", 5);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.keenable.ai/v1/search");
    expect(init.method).toBe("POST");
    expect(init.headers["X-API-Key"]).toBe("kn-test");
    expect(JSON.parse(init.body)).toEqual({
      query: "react hooks",
      max_results: 5,
      snippet_max_length: 500,
    });
    expect(text).toBe(
      "[1] React hooks\nURL: https://react.dev/hooks\nHooks let you\n\n" +
        "[2] Untitled\nURL: https://example.com\nFallback text"
    );
  });

  it("returns the same empty message as the Exa path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
    await expect(keenableWebSearch("kn-test", "q", 5)).resolves.toBe("No results found");
  });

  it("throws with the API message on an error status", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Authentication failed", message: "Malformed API key" }, 401)
    );
    await expect(keenableWebSearch("bad", "q", 5)).rejects.toThrow(
      "Keenable search failed (401): Malformed API key"
    );
  });
});

describe("keenableGetContents", () => {
  it("posts the URLs and skips pages that came back with an error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          { url: "https://a.com", title: "A", content: "x".repeat(10) },
          { url: "https://b.com", error: { message: "unreachable" } },
        ],
      })
    );

    const text = await keenableGetContents("kn-test", ["https://a.com", "https://b.com"], 4);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.keenable.ai/v1/fetch");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      urls: ["https://a.com", "https://b.com"],
    });
    expect(text).toBe("## A\nURL: https://a.com\n\nxxxx");
  });

  it("sends each URL once, keeping the order", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ url: "https://a.com", title: "A", content: "ok" }] })
    );
    await keenableGetContents("kn-test", ["https://a.com", "https://b.com", "https://a.com"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      urls: ["https://a.com", "https://b.com"],
    });
  });

  it("propagates a body that fails to decode on a 200", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(keenableGetContents("kn-test", ["https://a.com"])).rejects.toThrow();
  });

  it("reports when no page could be read", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ url: "https://b.com", error: { message: "gone" } }] })
    );
    await expect(keenableGetContents("kn-test", ["https://b.com"])).resolves.toBe(
      "Could not fetch content from URLs"
    );
  });
});
