import OpenAPIClientAxios from "openapi-client-axios";
import { StoreKey } from "../constant";
import { nanoid } from "nanoid";
import { createPersistStore } from "../utils/store";
import { getClientConfig } from "../config/client";
import yaml from "js-yaml";
import { adapter, getOperationId } from "../utils";

const isApp = getClientConfig()?.isApp !== false;

export type Plugin = {
  id: string;
  createdAt: number;
  title: string;
  version: string;
  content: string;
  builtin: boolean;
  authType?: string;
  authLocation?: string;
  authHeader?: string;
  authToken?: string;
  usingProxy?: boolean;
};

export type FunctionToolItem = {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters: Object;
  };
};

type FunctionToolServiceItem = {
  api: OpenAPIClientAxios;
  length: number;
  tools: FunctionToolItem[];
  funcs: Record<string, Function>;
};

export const FunctionToolService = {
  tools: {} as Record<string, FunctionToolServiceItem>,
  add(plugin: Plugin, replace = false) {
    if (!replace && this.tools[plugin.id]) return this.tools[plugin.id];
    const headerName = (
      plugin?.authType == "custom" ? plugin?.authHeader : "Authorization"
    ) as string;
    const tokenValue =
      plugin?.authType == "basic"
        ? `Basic ${plugin?.authToken}`
        : plugin?.authType == "bearer"
        ? ` Bearer ${plugin?.authToken}`
        : plugin?.authToken;
    const authLocation = plugin?.authLocation || "header";
    const definition = yaml.load(plugin.content) as any;
    const serverURL = definition?.servers?.[0]?.url;
    const baseURL = !!plugin?.usingProxy ? "/api/proxy" : serverURL;
    const headers: Record<string, string | undefined> = {
      "X-Base-URL": !!plugin?.usingProxy ? serverURL : undefined,
    };
    if (authLocation == "header") {
      headers[headerName] = tokenValue;
    }
    const api = new OpenAPIClientAxios({
      definition: yaml.load(plugin.content) as any,
      axiosConfigDefaults: {
        adapter: (window.__TAURI__ ? adapter : ["xhr"]) as any,
        baseURL,
        headers,
      },
    });
    try {
      api.initSync();
    } catch (e) {}
    const operations = api.getOperations();
    return (this.tools[plugin.id] = {
      api,
      length: operations.length,
      tools: operations.map((o) => {
        // @ts-ignore
        const parameters = o?.requestBody?.content["application/json"]
          ?.schema || {
          type: "object",
          properties: {},
        };
        if (!parameters["required"]) {
          parameters["required"] = [];
        }
        if (o.parameters instanceof Array) {
          o.parameters.forEach((p) => {
            // @ts-ignore
            if (p?.in == "query" || p?.in == "path") {
              // const name = `${p.in}__${p.name}`
              // @ts-ignore
              const name = p?.name;
              parameters["properties"][name] = {
                // @ts-ignore
                type: p.schema.type,
                // @ts-ignore
                description: p.description,
              };
              // @ts-ignore
              if (p.required) {
                parameters["required"].push(name);
              }
            }
          });
        }
        return {
          type: "function",
          function: {
            name: getOperationId(o),
            description: o.description || o.summary,
            parameters: parameters,
          },
        } as FunctionToolItem;
      }),
      funcs: operations.reduce((s, o) => {
        // @ts-ignore
        s[getOperationId(o)] = function (args) {
          const parameters: Record<string, any> = {};
          if (o.parameters instanceof Array) {
            o.parameters.forEach((p) => {
              // @ts-ignore
              parameters[p?.name] = args[p?.name];
              // @ts-ignore
              delete args[p?.name];
            });
          }
          if (authLocation == "query") {
            parameters[headerName] = tokenValue;
          } else if (authLocation == "body") {
            args[headerName] = tokenValue;
          }
          // @ts-ignore if o.operationId is null, then using o.path and o.method
          return api.client.paths[o.path][o.method](
            parameters,
            args,
            api.axiosConfigDefaults,
          );
        };
        return s;
      }, {}),
    });
  },
  get(id: string) {
    return this.tools[id];
  },
};

export const createEmptyPlugin = () =>
  ({
    id: nanoid(),
    title: "",
    version: "1.0.0",
    content: "",
    builtin: false,
    createdAt: Date.now(),
  }) as Plugin;

const PREDEFINED_PLUGINS: Record<string, Plugin> = {
  chatPdfGpt: {
    id: "chatPdfGpt",
    createdAt: Date.now(),
    title: "ChatPDF，允许AI从给定的链接读取PDF",
    version: "v1",
    content: JSON.stringify({
      openapi: "3.1.0",
      info: {
        description: "A GPT that allows the user to read data from a link.",
        title: "Chat PDF GPT",
        version: "v1",
      },
      servers: [
        {
          url: "https://gpt.chatpdf.aidocmaker.com",
        },
      ],
      paths: {
        "/read_url": {
          post: {
            description:
              "Allows for reading the contents of an URL link, including PDF/DOC/DOCX/PPT/CSV/XLS/XLSX/HTML content, Google Drive, Dropbox, OneDrive, aidocmaker.com docs. Always wrap image URLs from the response field `z1_image_urls` in Markdown, where each image has a ## DESCRIPTION.",
            operationId: "ChatPDFReadRrl",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ReadDocV2Request",
                  },
                },
              },
              required: true,
            },
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: {},
                  },
                },
                description: "Successful Response",
              },
              "422": {
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/HTTPValidationError",
                    },
                  },
                },
                description: "Validation Error",
              },
            },
            summary: "Read the contents of an URL link",
            "x-openai-isConsequential": false,
          },
        },
      },
      components: {
        schemas: {
          HTTPValidationError: {
            properties: {
              detail: {
                items: {
                  $ref: "#/components/schemas/ValidationError",
                },
                title: "Detail",
                type: "array",
              },
            },
            title: "HTTPValidationError",
            type: "object",
          },
          ReadDocV2Request: {
            properties: {
              f1_http_url: {
                description:
                  "User will pass a HTTPS or HTTP url to a file so that the file contents can be read.",
                title: "F1 Http Url",
                type: "string",
              },
              f2_query: {
                default: "",
                description:
                  "User will pass a query string to fetch relevant sections from the contents. It will be used for sentence-level similarity search on the document based on embeddings.",
                title: "F2 Query",
                type: "string",
              },
              f3_selected_pages: {
                default: [],
                description:
                  "Filter document on these page numbers. Use empty list to get all pages.",
                items: {
                  type: "integer",
                },
                title: "F3 Selected Pages",
                type: "array",
              },
            },
            required: ["f1_http_url"],
            title: "ReadDocV2Request",
            type: "object",
          },
          ValidationError: {
            properties: {
              loc: {
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "integer",
                    },
                  ],
                },
                title: "Location",
                type: "array",
              },
              msg: {
                title: "Message",
                type: "string",
              },
              type: {
                title: "Error Type",
                type: "string",
              },
            },
            required: ["loc", "msg", "type"],
            title: "ValidationError",
            type: "object",
          },
        },
      },
    }),
    builtin: true,
    authType: "none",
    authLocation: "",
    authHeader: "",
    authToken: "",
    usingProxy: true,
  },
  duckDuckGoLite: {
    id: "duckDuckGoLite",
    createdAt: Date.now(),
    title: "DuckDuckGo 互联网搜索，允许AI进行互联网检索",
    version: "v1.0.0",
    content: JSON.stringify({
      openapi: "3.1.0",
      info: {
        title: "duckduckgo lite",
        description:
          "a search engine. useful for when you need to answer questions about current events. input should be a search query.",
        version: "v1.0.0",
      },
      servers: [
        {
          url: "https://lite.duckduckgo.com",
        },
      ],
      paths: {
        "/lite/": {
          post: {
            operationId: "DuckDuckGoLiteSearch",
            description:
              "a search engine. useful for when you need to answer questions about current events. input should be a search query.",
            deprecated: false,
            parameters: [
              {
                name: "q",
                in: "query",
                required: true,
                description: "keywords for query.",
                schema: {
                  type: "string",
                },
              },
              {
                name: "s",
                in: "query",
                description: "can be `0`",
                schema: {
                  type: "number",
                },
              },
              {
                name: "o",
                in: "query",
                description: "can be `json`",
                schema: {
                  type: "string",
                },
              },
              {
                name: "api",
                in: "query",
                description: "can be `d.js`",
                schema: {
                  type: "string",
                },
              },
              {
                name: "kl",
                in: "query",
                description:
                  "wt-wt, us-en, uk-en, ru-ru, etc. Defaults to `wt-wt`.",
                schema: {
                  type: "string",
                },
              },
              {
                name: "bing_market",
                in: "query",
                description:
                  "wt-wt, us-en, uk-en, ru-ru, etc. Defaults to `wt-wt`.",
                schema: {
                  type: "string",
                },
              },
            ],
          },
        },
      },
      components: {
        schemas: {},
      },
    }),
    builtin: true,
    authType: "none",
    authLocation: "",
    authHeader: "",
    authToken: "",
    usingProxy: true,
  },
  arxivSearch: {
    id: "arxivSearch",
    createdAt: Date.now(),
    title: "Arxiv 搜索，允许AI搜索并获取Arxiv文章信息",
    version: "v1.0.0",
    content: JSON.stringify({
      openapi: "3.1.0",
      info: {
        title: "arxiv search",
        description: "Run Arxiv search and get the article information.",
        version: "v1.0.0",
      },
      servers: [
        {
          url: "https://export.arxiv.org",
        },
      ],
      paths: {
        "/api/query": {
          get: {
            operationId: "ArxivSearch",
            description: "Run Arxiv search and get the article information.",
            deprecated: false,
            parameters: [
              {
                name: "search_query",
                in: "query",
                required: true,
                description:
                  "same as the search_query parameter rules of the arxiv API.",
                schema: {
                  type: "string",
                },
              },
              {
                name: "sortBy",
                in: "query",
                description:
                  "can be `relevance`, `lastUpdatedDate`, `submittedDate`.",
                schema: {
                  type: "string",
                },
              },
              {
                name: "sortOrder",
                in: "query",
                description: "can be either `ascending` or `descending`.",
                schema: {
                  type: "string",
                },
              },
              {
                name: "start",
                in: "query",
                description: "the index of the first returned result.",
                schema: {
                  type: "number",
                },
              },
              {
                name: "max_results",
                in: "query",
                description: "the number of results returned by the query.",
                schema: {
                  type: "number",
                },
              },
            ],
          },
        },
      },
      components: {
        schemas: {},
      },
    }),
    builtin: true,
    authType: "none",
    authLocation: "",
    authHeader: "",
    authToken: "",
    usingProxy: true,
  },
  codeInterpreter: {
    id: "codeInterpreter",
    createdAt: Date.now(),
    title: "动态编码器，允许AI运行Python代码并返回结果",
    version: "1.0.0",
    content: JSON.stringify({
      openapi: "3.1.0",
      info: {
        title: "CodeInterpreter",
        version: "1.0.0",
      },
      servers: [
        {
          url: "https://code.leez.tech",
        },
      ],
      paths: {
        "/runcode": {
          post: {
            operationId: "CodeInterpreter",
            "x-openai-isConsequential": false,
            summary: "Run a given Python program and return the output.",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["code", "languageType", "variables"],
                    properties: {
                      code: {
                        type: "string",
                        description: "The Python code to execute",
                      },
                      languageType: {
                        type: "string",
                        description: "value is `python`",
                      },
                      variables: {
                        type: "object",
                        description: "value is empty dict: `{}`",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    builtin: true,
    authType: "none",
    authLocation: "",
    authHeader: "",
    authToken: "",
    usingProxy: true,
  },
};

export const DEFAULT_PLUGIN_STATE = {
  plugins: {
    ...PREDEFINED_PLUGINS,
  } as Record<string, Plugin>,
};

export const usePluginStore = createPersistStore(
  { ...DEFAULT_PLUGIN_STATE },

  (set, get) => ({
    create(plugin?: Partial<Plugin>) {
      const plugins = get().plugins;
      const id = plugin?.id || nanoid();
      plugins[id] = {
        ...createEmptyPlugin(),
        ...plugin,
        id,
        builtin: false,
      };

      set(() => ({ plugins }));
      get().markUpdate();

      return plugins[id];
    },
    updatePlugin(id: string, updater: (plugin: Plugin) => void) {
      const plugins = get().plugins;
      const plugin = plugins[id];
      if (!plugin) return;
      const updatePlugin = { ...plugin };
      updater(updatePlugin);
      plugins[id] = updatePlugin;
      FunctionToolService.add(updatePlugin, true);
      set(() => ({ plugins }));
      get().markUpdate();
    },
    delete(id: string) {
      const plugins = get().plugins;
      delete plugins[id];
      set(() => ({ plugins }));
      get().markUpdate();
    },

    getAsTools(ids: string[]) {
      const plugins = get().plugins;
      const selected = (ids || [])
        .map((id) => plugins[id])
        .filter((i) => i)
        .map((p) => FunctionToolService.add(p));
      return [
        // @ts-ignore
        selected.reduce((s, i) => s.concat(i.tools), []),
        selected.reduce((s, i) => Object.assign(s, i.funcs), {}),
      ];
    },
    get(id?: string) {
      return get().plugins[id ?? 1145141919810];
    },
    getAll() {
      return Object.values(get().plugins).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    },
  }),
  {
    name: StoreKey.Plugin,
    version: 1,
    onRehydrateStorage(state) {
      // Skip store rehydration on server side
      if (typeof window === "undefined") {
        return;
      }

      fetch("./plugins.json")
        .then((res) => res.json())
        .then((res) => {
          Promise.all(
            res.map((item: any) =>
              // skip get schema
              state.get(item.id)
                ? item
                : fetch(item.schema)
                    .then((res) => res.text())
                    .then((content) => ({
                      ...item,
                      content,
                    }))
                    .catch((e) => item),
            ),
          ).then((builtinPlugins: any) => {
            builtinPlugins
              .filter((item: any) => item?.content)
              .forEach((item: any) => {
                const plugin = state.create(item);
                state.updatePlugin(plugin.id, (plugin) => {
                  const tool = FunctionToolService.add(plugin, true);
                  plugin.title = tool.api.definition.info.title;
                  plugin.version = tool.api.definition.info.version;
                  plugin.builtin = true;
                });
              });
          });
        });
    },
  },
);
