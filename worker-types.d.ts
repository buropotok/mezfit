interface D1PreparedStatement { first<T = unknown>(): Promise<T | null>; }
interface D1Database { prepare(query: string): D1PreparedStatement; }
interface Fetcher { fetch(request: Request): Promise<Response>; }
interface ExportedHandler<Env = unknown> { fetch(request: Request, env: Env, ctx?: unknown): Response | Promise<Response>; }
