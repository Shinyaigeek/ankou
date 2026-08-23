/**
 * JSON-RPC 2.0 over stdio, newline-delimited: the transport MCP runs on.
 *
 * Hand-rolled for the same reason the JSON Schema validator and the HTML
 * extractor are: the protocol surface a stdio server actually needs is a
 * request loop, and a dependency here would be the only runtime dependency in
 * the project.
 */

export interface RpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export interface RpcError {
  code: number
  message: string
  data?: unknown
}

/** The subset of JSON-RPC error codes this server can produce. */
export const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const

export class MethodError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'MethodError'
  }
}

export type Handler = (
  params: Record<string, unknown>,
  method: string,
) => Promise<unknown> | unknown

/**
 * Read newline-delimited JSON from `input`, dispatch, write replies to `output`.
 *
 * A notification (no `id`) is dispatched and never answered, which is what
 * `notifications/initialized` is. A request whose handler throws answers with an
 * error object rather than killing the loop: a client that asked for something
 * impossible is still a client we are talking to.
 */
export async function serve(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  dispatch: Handler,
): Promise<void> {
  let buffer = ''

  const send = (message: unknown) => {
    output.write(`${JSON.stringify(message)}\n`)
  }

  const handle = async (line: string) => {
    let request: RpcRequest
    try {
      request = JSON.parse(line) as RpcRequest
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: RPC.parse, message: 'Invalid JSON.' } })
      return
    }

    if (!request || typeof request.method !== 'string') {
      send({
        jsonrpc: '2.0',
        id: request?.id ?? null,
        error: { code: RPC.invalidRequest, message: 'Not a JSON-RPC request.' },
      })
      return
    }

    const isNotification = request.id === undefined || request.id === null
    try {
      const result = await dispatch(request.params ?? {}, request.method)
      if (!isNotification) send({ jsonrpc: '2.0', id: request.id, result })
    } catch (error) {
      if (isNotification) return
      const failure: RpcError =
        error instanceof MethodError
          ? {
              code: error.code,
              message: error.message,
              ...(error.data ? { data: error.data } : {}),
            }
          : { code: RPC.internal, message: error instanceof Error ? error.message : String(error) }
      send({ jsonrpc: '2.0', id: request.id, error: failure })
    }
  }

  input.setEncoding('utf8')
  for await (const chunk of input) {
    buffer += chunk
    let cut = buffer.indexOf('\n')
    while (cut !== -1) {
      const line = buffer.slice(0, cut).trim()
      buffer = buffer.slice(cut + 1)
      // Sequential on purpose: a client may depend on the order of two calls,
      // and the jobs this server runs are stateful.
      if (line) await handle(line)
      cut = buffer.indexOf('\n')
    }
  }
}
