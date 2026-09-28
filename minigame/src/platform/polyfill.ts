/**
 * 给 colyseus.js 补浏览器全局：WebSocket（底层 connectSocket）与
 * XMLHttpRequest（底层 request，供其依赖 httpie 发匹配请求）。
 * colyseus.js 在模块加载时就读取 globalThis.WebSocket，
 * 所以入口必须第一个 import 本文件。
 */
import { api, type SocketTask } from "./index";

type Handler = ((ev: any) => void) | null;

class MiniWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MiniWebSocket.CONNECTING;
  binaryType = "arraybuffer";
  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;
  private task: SocketTask;

  constructor(url: string, protocols?: string | string[] | { protocols?: string[] }) {
    const list =
      typeof protocols === "string"
        ? [protocols]
        : Array.isArray(protocols)
          ? protocols
          : protocols?.protocols;
    this.task = api.connectSocket(
      list?.length ? { url, protocols: list } : { url }
    );
    this.task.onOpen(() => {
      this.readyState = MiniWebSocket.OPEN;
      this.onopen?.({});
    });
    this.task.onMessage((res) => this.onmessage?.({ data: res.data }));
    this.task.onClose((res) => {
      this.readyState = MiniWebSocket.CLOSED;
      this.onclose?.({ code: res.code, reason: res.reason });
    });
    this.task.onError((res) => this.onerror?.({ message: res.errMsg }));
  }

  send(data: string | ArrayBuffer): void {
    this.task.send({ data });
  }

  close(code?: number, reason?: string): void {
    this.readyState = MiniWebSocket.CLOSING;
    this.task.close({ code, reason });
  }
}

class MiniXMLHttpRequest {
  status = 0;
  statusText = "";
  response: string | null = null;
  timeout = 0;
  withCredentials = false;
  onload: Handler = null;
  onerror: Handler = null;
  ontimeout: Handler = null;
  private method = "GET";
  private url = "";
  private reqHeaders: Record<string, string> = {};
  private resHeaders: Record<string, string> = {};

  open(method: string, url: string): void {
    this.method = method.toUpperCase();
    this.url = url;
  }

  setRequestHeader(key: string, value: string): void {
    this.reqHeaders[key] = value;
  }

  getAllResponseHeaders(): string {
    return Object.entries(this.resHeaders)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
  }

  send(body?: string): void {
    api.request({
      url: this.url,
      method: this.method,
      header: this.reqHeaders,
      data: body,
      dataType: "text",
      responseType: "text",
      timeout: this.timeout || undefined,
      success: (res) => {
        this.status = res.statusCode;
        this.response =
          typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        this.resHeaders = {};
        for (const [k, v] of Object.entries(res.header ?? {}))
          this.resHeaders[k.toLowerCase()] = String(v);
        this.onload?.({});
      },
      fail: (err) => {
        const timeout = /timeout/i.test(err.errMsg);
        const ev = { type: timeout ? "timeout" : "error", message: err.errMsg };
        (timeout ? this.ontimeout : this.onerror)?.(ev);
      },
    });
  }
}

const g = globalThis as Record<string, unknown>;
g.WebSocket = MiniWebSocket;
g.XMLHttpRequest = MiniXMLHttpRequest;
