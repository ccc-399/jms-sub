// ============================================================
// JMS 搬瓦工多订阅转换 - Deno Deploy
// 支持 5 个独立订阅
//
// 访问方式：
// /sub/jms1?token=xxx
// /sub/jms2?token=xxx
// /sub/jms3?token=xxx
// /sub/jms4?token=xxx
// /sub/jms5?token=xxx
//
// 环境变量：
// SUB_TOKEN
//
// JMS1_SUB_URL
// JMS1_BW_API
//
// JMS2_SUB_URL
// JMS2_BW_API
//
// JMS3_SUB_URL
// JMS3_BW_API
//
// JMS4_SUB_URL
// JMS4_BW_API
//
// JMS5_SUB_URL
// JMS5_BW_API
// ============================================================


// ============================================================
// 1. 多订阅配置
// ============================================================

const SUBSCRIPTIONS = {
  jms1: {
    name: "JMS 搬瓦工 1",
    subUrlEnv: "JMS1_SUB_URL",
    bwApiEnv: "JMS1_BW_API",
  },

  jms2: {
    name: "JMS 搬瓦工 2",
    subUrlEnv: "JMS2_SUB_URL",
    bwApiEnv: "JMS2_BW_API",
  },

  jms3: {
    name: "JMS 搬瓦工 3",
    subUrlEnv: "JMS3_SUB_URL",
    bwApiEnv: "JMS3_BW_API",
  },

  jms4: {
    name: "JMS 搬瓦工 4",
    subUrlEnv: "JMS4_SUB_URL",
    bwApiEnv: "JMS4_BW_API",
  },

  jms5: {
    name: "JMS 搬瓦工 5",
    subUrlEnv: "JMS5_SUB_URL",
    bwApiEnv: "JMS5_BW_API",
  },
} as const;


// ============================================================
// 2. 节点名称
// ============================================================

const NODE_NAMES: Record<string, string> = {
  s1: "🇺🇸 洛杉矶 01",
  s2: "🇺🇸 洛杉矶 02",
  s3: "🇺🇸 洛杉矶 03",
  s4: "🇯🇵 日本大阪",
  s5: "🇳🇱 荷兰",

  s801:
    "🇺🇸 洛杉矶 04｜x0.01倍 省流量平时使用这个",
};


// ============================================================
// 3. Deno HTTP Server
// ============================================================

Deno.serve(async (request: Request) => {
  try {

    const url =
      new URL(request.url);


    // ========================================================
    // 健康检查
    // ========================================================

    if (url.pathname === "/health") {

      return new Response(
        "OK - JMS multi subscription service works",
        {
          status: 200,

          headers: {
            "Content-Type":
              "text/plain; charset=utf-8",

            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    // ========================================================
    // 4. 验证 Token
    // ========================================================

    const SUB_TOKEN =
      Deno.env.get("SUB_TOKEN");


    if (
      !SUB_TOKEN ||
      url.searchParams.get("token") !== SUB_TOKEN
    ) {

      return new Response(
        "Forbidden",
        {
          status: 403,

          headers: {
            "Content-Type":
              "text/plain; charset=utf-8",

            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    // ========================================================
    // 5. 从 URL 获取订阅编号
    //
    // /sub/jms1
    // /sub/jms2
    // ...
    // /sub/jms5
    // ========================================================

    const match =
      url.pathname.match(
        /^\/sub\/(jms[1-5])\/?$/,
      );


    if (!match) {

      return new Response(
        [
          "JMS Multi Subscription Service",
          "",
          "Available paths:",
          "/sub/jms1",
          "/sub/jms2",
          "/sub/jms3",
          "/sub/jms4",
          "/sub/jms5",
        ].join("\n"),
        {
          status: 404,

          headers: {
            "Content-Type":
              "text/plain; charset=utf-8",

            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    const subId =
      match[1] as keyof typeof SUBSCRIPTIONS;


    const subConfig =
      SUBSCRIPTIONS[subId];


    if (!subConfig) {

      return new Response(
        "Unknown subscription",
        {
          status: 404,

          headers: {
            "Content-Type":
              "text/plain; charset=utf-8",
          },
        },
      );
    }


    // ========================================================
    // 6. 根据订阅编号读取对应环境变量
    // ========================================================

    const JMS_SUB_URL =
      Deno.env.get(
        subConfig.subUrlEnv,
      );


    const JMS_BW_API =
      Deno.env.get(
        subConfig.bwApiEnv,
      );


    if (!JMS_SUB_URL) {

      return new Response(
        `${subConfig.subUrlEnv} is not configured.`,
        {
          status: 500,

          headers: {
            "Content-Type":
              "text/plain; charset=utf-8",

            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    // ========================================================
    // 7. 获取对应 JMS 官方订阅
    // ========================================================

    const upstream =
      await fetch(
        JMS_SUB_URL,
        {
          headers: {
            "User-Agent":
              "clash-verge",

            "Accept":
              "*/*",
          },

          redirect:
            "follow",
        },
      );


    if (!upstream.ok) {

      return new Response(
        `Failed to fetch ${subConfig.name}: ${upstream.status}`,
        {
          status: 502,

          headers: {
            "Content-Type":
              "text/plain; charset=utf-8",

            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    let yaml =
      await upstream.text();


    // ========================================================
    // 8. 修改 Clash 配置
    // ========================================================

    // 节点中文名称
    yaml =
      renameJmsNodes(yaml);


    // 根据实际存在节点自动重建代理组
    yaml =
      rebuildProxyGroups(yaml);


    // 国内直连 / 国外代理
    yaml =
      addRoutingRules(yaml);


    // ========================================================
    // 9. 获取对应账户实时流量
    // ========================================================

    let total:
      number | null = null;


    let used:
      number | null = null;


    let resetDay:
      number | null = null;


    if (JMS_BW_API) {

      try {

        const bwResponse =
          await fetch(
            JMS_BW_API,
            {
              headers: {
                "User-Agent":
                  "Mozilla/5.0",

                "Accept":
                  "application/json",
              },

              redirect:
                "follow",
            },
          );


        if (bwResponse.ok) {

          const bwData =
            await bwResponse.json();


          if (
            bwData.monthly_bw_limit_b
              !== undefined &&
            bwData.bw_counter_b
              !== undefined
          ) {

            total =
              Number(
                bwData.monthly_bw_limit_b,
              );


            used =
              Number(
                bwData.bw_counter_b,
              );


            if (
              bwData.bw_reset_day_of_month
                !== undefined
            ) {

              resetDay =
                Number(
                  bwData
                    .bw_reset_day_of_month,
                );
            }
          }

        } else {

          console.log(
            `${subId} bandwidth API HTTP error:`,
            bwResponse.status,
          );
        }

      } catch (error) {

        console.log(
          `${subId} bandwidth API error:`,
          error,
        );
      }
    }


    // ========================================================
    // 10. Clash Subscription-Userinfo
    // ========================================================

    let subscriptionInfo = "";


    if (
      total !== null &&
      used !== null &&
      Number.isFinite(total) &&
      Number.isFinite(used)
    ) {

      let expire:
        number | null = null;


      if (
        resetDay !== null &&
        Number.isFinite(resetDay) &&
        resetDay >= 1 &&
        resetDay <= 31
      ) {

        expire =
          getNextResetTimestamp(
            resetDay,
          );
      }


      subscriptionInfo =
        `upload=0; download=${Math.floor(used)}; total=${Math.floor(total)}`;


      if (expire) {

        subscriptionInfo +=
          `; expire=${expire}`;
      }

    } else {

      // 流量 API 获取失败时
      // 使用对应官方订阅返回的 Header

      subscriptionInfo =
        upstream.headers.get(
          "subscription-userinfo",
        ) || "";
    }


    // ========================================================
    // 11. 返回 Clash 配置
    // ========================================================

    const headers =
      new Headers();


    headers.set(
      "Content-Type",
      "text/yaml; charset=utf-8",
    );


    // 每个订阅显示不同名称

    const encodedFilename =
      encodeURIComponent(
        subConfig.name,
      );


    headers.set(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodedFilename}`,
    );


    // 6 小时自动更新

    headers.set(
      "Profile-Update-Interval",
      "6",
    );


    // 禁止缓存旧订阅

    headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate",
    );


    headers.set(
      "Pragma",
      "no-cache",
    );


    if (subscriptionInfo) {

      headers.set(
        "Subscription-Userinfo",
        subscriptionInfo,
      );
    }


    return new Response(
      yaml,
      {
        status: 200,
        headers,
      },
    );


  } catch (error) {

    console.error(
      "Deno subscription error:",
      error,
    );


    const message =
      error instanceof Error
        ? error.message
        : String(error);


    return new Response(
      "Deno Error: " + message,
      {
        status: 500,

        headers: {
          "Content-Type":
            "text/plain; charset=utf-8",

          "Cache-Control":
            "no-store",
        },
      },
    );
  }
});


// ============================================================
// 12. 节点自动重命名
//
// 支持类似：
//
// c10s1
// c10s2
// c70s1
// c70s801
//
// 等 JMS 动态前缀
// ============================================================

function renameJmsNodes(
  yaml: string,
): string {

  for (
    const [serverId, newName]
    of Object.entries(NODE_NAMES)
  ) {

    const escapedId =
      escapeRegExp(serverId);


    const pattern =
      new RegExp(
        `JMS-[^"'\\s,@]+@[A-Za-z0-9]*${escapedId}\\.portablesubmarines\\.com:\\d+`,
        "g",
      );


    yaml =
      yaml.replace(
        pattern,
        newName,
      );
  }


  return yaml;
}


// ============================================================
// 13. 找出当前订阅实际存在的节点
//
// 与旧版本不同：
// 不再强制假设每个订阅都有全部节点。
//
// 如果某个账户没有日本/荷兰/某个 LA 节点，
// 就不会把不存在的节点写入 proxy-groups。
// ============================================================

function getExistingNodes(
  yaml: string,
): string[] {

  const orderedNodes = [
    "🇺🇸 洛杉矶 04｜x0.01倍 省流量平时使用这个",
    "🇺🇸 洛杉矶 01",
    "🇺🇸 洛杉矶 02",
    "🇺🇸 洛杉矶 03",
    "🇯🇵 日本大阪",
    "🇳🇱 荷兰",
  ];


  return orderedNodes.filter(
    (nodeName) => {

      const escaped =
        escapeRegExp(nodeName);


      // 只检查 proxies 区域里是否存在这个 name
      // 支持：
      // name: "xxx"
      // name: 'xxx'
      // name: xxx

      const pattern =
        new RegExp(
          `name:\\s*["']?${escaped}["']?(?:\\s|,|$)`,
          "m",
        );


      return pattern.test(yaml);
    },
  );
}


// ============================================================
// 14. 重建 proxy-groups
//
// JMS 主组：
// 默认第一项 = 自动故障切换
//
// fallback：
// 优先顺序：
// 1. x0.01 洛杉矶04
// 2. 洛杉矶01
// 3. 洛杉矶02
// 4. 洛杉矶03
// 5. 日本大阪
// 6. 荷兰
//
// 但只添加当前订阅实际存在的节点。
// ============================================================

function rebuildProxyGroups(
  yaml: string,
): string {

  const lines =
    yaml.split(/\r?\n/);


  const proxyIndex =
    lines.findIndex(
      (line) =>
        /^proxy-groups:\s*$/.test(line),
    );


  if (proxyIndex === -1) {

    return yaml;
  }


  // ==========================================================
  // 获取实际存在节点
  // ==========================================================

  const existingNodes =
    getExistingNodes(yaml);


  // 一个都没识别出来时
  // 为防止生成坏配置，保持官方 proxy-groups 不动

  if (existingNodes.length === 0) {

    console.log(
      "No known JMS nodes detected; keeping original proxy-groups.",
    );

    return yaml;
  }


  // ==========================================================
  // 找 proxy-groups 后面的下一个顶级 YAML 区块
  // ==========================================================

  let nextTopLevelIndex = -1;


  for (
    let i = proxyIndex + 1;
    i < lines.length;
    i++
  ) {

    const line =
      lines[i];


    if (
      /^[A-Za-z0-9_-]+:\s*(?:.*)?$/.test(line) &&
      !/^\s/.test(line)
    ) {

      nextTopLevelIndex = i;

      break;
    }
  }


  // ==========================================================
  // 生成节点列表
  // ==========================================================

  const manualProxyLines =
    existingNodes.map(
      (name) =>
        `  - "${name}"`,
    );


  const fallbackProxyLines =
    existingNodes.map(
      (name) =>
        `  - "${name}"`,
    );


  // ==========================================================
  // 新 proxy-groups
  // ==========================================================

  const newProxyGroups = [

    "proxy-groups:",
    "",


    // ========================================================
    // JMS 主组
    // ========================================================

    '- name: "JMS"',

    "  type: select",

    "  proxies:",


    // 默认自动故障切换

    '  - "🔄 自动故障切换"',


    // 当前订阅实际存在节点

    ...manualProxyLines,


    // 允许手动直连

    "  - DIRECT",

    "",


    // ========================================================
    // 自动故障切换
    // ========================================================

    '- name: "🔄 自动故障切换"',

    "  type: fallback",

    "  proxies:",


    ...fallbackProxyLines,


    // 测试地址

    '  url: "https://www.gstatic.com/generate_204"',


    // 每 5 分钟检测一次

    "  interval: 300",

    "",
  ];


  // ==========================================================
  // proxy-groups 是最后一个区块
  // ==========================================================

  if (
    nextTopLevelIndex === -1
  ) {

    return [

      ...lines.slice(
        0,
        proxyIndex,
      ),

      ...newProxyGroups,

    ].join("\n");
  }


  // ==========================================================
  // proxy-groups 后面还有其他区块
  // ==========================================================

  return [

    ...lines.slice(
      0,
      proxyIndex,
    ),

    ...newProxyGroups,

    ...lines.slice(
      nextTopLevelIndex,
    ),

  ].join("\n");
}


// ============================================================
// 15. 国内直连 / 国外代理
//
// 局域网 / 私有地址 → DIRECT
// 中国大陆          → DIRECT
// 其他所有流量      → JMS
//
// JMS 默认使用：🔄 自动故障切换
// ============================================================

function addRoutingRules(
  yaml: string,
): string {

  const lines =
    yaml.split(/\r?\n/);


  const rulesIndex =
    lines.findIndex(
      (line) =>
        /^rules:\s*$/.test(line),
    );


  const newRules = [

    "rules:",


    // ========================================================
    // 局域网 / 私有地址
    // ========================================================

    '- "GEOSITE,private,DIRECT"',

    '- "GEOIP,private,DIRECT,no-resolve"',


    // ========================================================
    // 中国大陆网站
    // ========================================================

    '- "GEOSITE,CN,DIRECT"',


    // ========================================================
    // 中国大陆 IP
    // ========================================================

    '- "GEOIP,CN,DIRECT,no-resolve"',


    // ========================================================
    // 其余所有流量
    //
    // ChatGPT / OpenAI
    // TikTok
    // Google
    // YouTube
    // Instagram
    // Facebook
    // X / Twitter
    // Telegram
    // 以及其他未命中中国大陆规则的流量
    // ========================================================

    '- "MATCH,JMS"',
  ];


  // ==========================================================
  // 官方配置不存在 rules:
  // ==========================================================

  if (rulesIndex === -1) {

    return [

      yaml.trimEnd(),

      "",

      ...newRules,

      "",

    ].join("\n");
  }


  // ==========================================================
  // 找 rules 后面的下一个顶级区块
  // ==========================================================

  let nextTopLevelIndex = -1;


  for (
    let i = rulesIndex + 1;
    i < lines.length;
    i++
  ) {

    const line =
      lines[i];


    if (
      /^[A-Za-z0-9_-]+:\s*(?:.*)?$/.test(line) &&
      !/^\s/.test(line)
    ) {

      nextTopLevelIndex = i;

      break;
    }
  }


  // ==========================================================
  // rules 位于文件末尾
  // ==========================================================

  if (
    nextTopLevelIndex === -1
  ) {

    return [

      ...lines.slice(
        0,
        rulesIndex,
      ),

      ...newRules,

      "",

    ].join("\n");
  }


  // ==========================================================
  // rules 后面还有其他区块
  // ==========================================================

  return [

    ...lines.slice(
      0,
      rulesIndex,
    ),

    ...newRules,

    "",

    ...lines.slice(
      nextTopLevelIndex,
    ),

  ].join("\n");
}


// ============================================================
// 16. 下一次 JMS 流量重置日期
//
// 使用 Los Angeles 时区
// ============================================================

function getNextResetTimestamp(
  resetDay: number,
): number {

  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/Los_Angeles",

        year:
          "numeric",

        month:
          "numeric",

        day:
          "numeric",
      },
    ).formatToParts(
      new Date(),
    );


  const get =
    (type: string): number => {

      const part =
        parts.find(
          (p) =>
            p.type === type,
        );


      if (!part) {

        throw new Error(
          `Unable to read date part: ${type}`,
        );
      }


      return Number(
        part.value,
      );
    };


  let year =
    get("year");


  let month =
    get("month");


  const day =
    get("day");


  // ==========================================================
  // 本月已经达到重置日
  // 下一次 = 下个月
  // ==========================================================

  if (
    day >= resetDay
  ) {

    month++;


    if (
      month > 12
    ) {

      month = 1;

      year++;
    }
  }


  // ==========================================================
  // 防止 2月30 / 2月31 等不存在日期
  // ==========================================================

  const lastDay =
    new Date(
      Date.UTC(
        year,
        month,
        0,
      ),
    ).getUTCDate();


  const targetDay =
    Math.min(
      resetDay,
      lastDay,
    );


  // ==========================================================
  // 使用中午 UTC
  // ==========================================================

  return Math.floor(
    Date.UTC(
      year,
      month - 1,
      targetDay,
      12,
      0,
      0,
    ) / 1000,
  );
}


// ============================================================
// 17. 正则转义
// ============================================================

function escapeRegExp(
  value: string,
): string {

  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}
