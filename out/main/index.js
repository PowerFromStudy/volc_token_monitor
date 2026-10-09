"use strict";
const electron = require("electron");
const path = require("path");
const Store = require("electron-store");
const crypto = require("node:crypto");
const nodeMachineId = require("node-machine-id");
const axios = require("axios");
const node_fs = require("node:fs");
const node_os = require("node:os");
const node_path = require("node:path");
const DEFAULT_SETTINGS = {
  pollInterval: 12e4,
  warnThreshold: 70,
  dangerThreshold: 90,
  autoSwitch: true,
  autoSwitchThreshold: 90,
  expireWarnDays: 3,
  theme: "default",
  model: ""
};
const ALGO = "aes-256-gcm";
function deriveKey() {
  const mid = nodeMachineId.machineIdSync();
  const user = process.env.USERNAME || process.env.USER || "default";
  return crypto.scryptSync(`${mid}:${user}:volc-token-monitor`, "volc-salt", 32);
}
function encrypt(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}
function decrypt(ciphertext) {
  const key = deriveKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
class KeyManager {
  constructor(raw) {
    this.store = {};
    if (raw) {
      try {
        this.store = JSON.parse(raw);
      } catch {
        this.store = {};
      }
    }
  }
  toJSON() {
    return JSON.stringify(this.store, null, 2);
  }
  /** 列出所有账号 (解密 AK/SK) */
  list() {
    return Object.values(this.store).map((a) => ({
      id: a.id,
      name: a.name,
      accessKey: decrypt(a.accessKeyEnc),
      secretKey: decrypt(a.secretKeyEnc),
      edition: a.edition,
      remark: a.remark,
      createdAt: a.createdAt
    }));
  }
  get(id) {
    const a = this.store[id];
    if (!a) return void 0;
    return {
      id: a.id,
      name: a.name,
      accessKey: decrypt(a.accessKeyEnc),
      secretKey: decrypt(a.secretKeyEnc),
      edition: a.edition,
      remark: a.remark,
      createdAt: a.createdAt
    };
  }
  add(account) {
    const id = account.id || crypto.randomUUID();
    const stored = {
      id,
      name: account.name,
      accessKeyEnc: encrypt(account.accessKey),
      secretKeyEnc: encrypt(account.secretKey),
      edition: account.edition,
      remark: account.remark,
      createdAt: Date.now()
    };
    this.store[id] = stored;
    return this.get(id);
  }
  update(id, patch) {
    const a = this.store[id];
    if (!a) return void 0;
    if (patch.name !== void 0) a.name = patch.name;
    if (patch.accessKey !== void 0) a.accessKeyEnc = encrypt(patch.accessKey);
    if (patch.secretKey !== void 0) a.secretKeyEnc = encrypt(patch.secretKey);
    if (patch.edition !== void 0) a.edition = patch.edition;
    if (patch.remark !== void 0) a.remark = patch.remark;
    return this.get(id);
  }
  remove(id) {
    if (!this.store[id]) return false;
    delete this.store[id];
    return true;
  }
}
class AppStore {
  constructor() {
    this.store = new Store({
      name: "volc-token-monitor",
      defaults: {
        accountsRaw: "{}",
        seats: [],
        settings: DEFAULT_SETTINGS
      }
    });
    this.keyManager = new KeyManager(this.store.get("accountsRaw"));
  }
  // ---------- 账号 ----------
  listAccounts() {
    return this.keyManager.list();
  }
  addAccount(account) {
    const a = this.keyManager.add(account);
    this.persistAccounts();
    return a;
  }
  updateAccount(id, patch) {
    const a = this.keyManager.update(id, patch);
    this.persistAccounts();
    return a;
  }
  removeAccount(id) {
    const ok = this.keyManager.remove(id);
    if (ok) this.persistAccounts();
    return ok;
  }
  persistAccounts() {
    this.store.set("accountsRaw", this.keyManager.toJSON());
  }
  // ---------- 席位 ----------
  getSeats() {
    return this.store.get("seats");
  }
  setSeats(seats) {
    this.store.set("seats", seats);
  }
  upsertSeat(seat) {
    const seats = this.getSeats();
    const idx = seats.findIndex((s) => s.seatId === seat.seatId);
    if (idx >= 0) seats[idx] = seat;
    else seats.push(seat);
    this.setSeats(seats);
  }
  removeSeatsByAccount(accountId) {
    const seats = this.getSeats().filter((s) => s.accountId !== accountId);
    this.setSeats(seats);
  }
  // ---------- 设置 ----------
  getSettings() {
    return { ...DEFAULT_SETTINGS, ...this.store.get("settings") };
  }
  setSettings(settings) {
    const cur = this.getSettings();
    this.store.set("settings", { ...cur, ...settings });
  }
  // ---------- 激活席位 ----------
  getActiveSeatId() {
    return this.store.get("activeSeatId");
  }
  setActiveSeatId(id) {
    if (id) this.store.set("activeSeatId", id);
    else this.store.delete("activeSeatId");
  }
}
const SERVICE = "ark";
const REGION = "cn-beijing";
const HOST = "ark.cn-beijing.volcengineapi.com";
const VERSION = "2024-01-01";
function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function hmacSha256(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}
function toHex(buf) {
  return buf.toString("hex");
}
class VolcApiClient {
  constructor(config) {
    this.ak = config.accessKey;
    this.sk = config.secretKey;
    this.http = axios.create({
      baseURL: `https://${HOST}`,
      timeout: 15e3,
      headers: { "Content-Type": "application/json" }
    });
  }
  /**
   * 生成火山引擎签名并发起请求
   * 签名算法: HMAC-SHA256 (Volcengine V4)
   */
  async request(action, body = {}) {
    const bodyStr = JSON.stringify(body);
    const contentSha256 = sha256Hex(bodyStr);
    const now = /* @__PURE__ */ new Date();
    const xDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const shortDate = xDate.slice(0, 8);
    const queryParams = {
      Action: action,
      Version: VERSION
    };
    const sortedKeys = Object.keys(queryParams).sort();
    const canonicalQueryString = sortedKeys.map((k) => `${k}=${encodeURIComponent(queryParams[k])}`).join("&");
    const canonicalHeaders = `content-type:application/json
host:${HOST}
x-content-sha256:${contentSha256}
x-date:${xDate}
`;
    const signedHeaders = "content-type;host;x-content-sha256;x-date";
    const canonicalRequest = [
      "POST",
      "/",
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      contentSha256
    ].join("\n");
    const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
    const hashedCanonicalRequest = sha256Hex(canonicalRequest);
    const stringToSign = `HMAC-SHA256
${xDate}
${credentialScope}
${hashedCanonicalRequest}`;
    const kDate = hmacSha256(this.sk, shortDate);
    const kRegion = hmacSha256(kDate, REGION);
    const kService = hmacSha256(kRegion, SERVICE);
    const kSigning = hmacSha256(kService, "request");
    const signature = toHex(hmacSha256(kSigning, stringToSign));
    const authorization = `HMAC-SHA256 Credential=${this.ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const resp = await this.http.post(`/?${canonicalQueryString}`, bodyStr, {
      headers: {
        "Content-Type": "application/json",
        "X-Date": xDate,
        "X-Content-Sha256": contentSha256,
        "Authorization": authorization
      }
    });
    const data = resp.data;
    if (data.ResponseMetadata?.Error) {
      const err = data.ResponseMetadata.Error;
      throw new Error(`[${err.Code}] ${err.Message}`);
    }
    return data.Result ?? data;
  }
  // ============ 套餐与席位 ============
  /** 查询个人版套餐信息 (AgentPlan / CodingPlan) */
  getPersonalPlan(plan) {
    return this.request("GetPersonalPlan", { Plan: plan });
  }
  /**
   * 查询个人版 Coding Plan 用量 (未公开文档 API, 社区已验证)
   * 返回 5h/周/月 已用百分比和重置时间
   */
  getCodingPlanUsage() {
    return this.request("GetCodingPlanUsage", {});
  }
  /** 查询席位列表 (企业版) */
  listSeatInfos(scene = "coding_plan_enterprise") {
    return this.request("ListSeatInfos", {
      Scene: scene,
      Filter: {},
      PageSize: 100,
      PageNum: 1
    });
  }
  // ============ Coding Plan 用量 ============
  /** 查询单个席位用量 (Coding Plan) - 返回百分比 */
  getSeatInfoUsage(seatId, scene) {
    const body = { SeatID: seatId, ProjectName: "default" };
    if (scene) body.Scene = scene;
    return this.request("GetSeatInfoUsage", body);
  }
  /** 批量查询席位用量 (Coding Plan) */
  listSeatInfoUsages(seatIds, scene) {
    const body = { SeatIDs: seatIds, ProjectName: "default" };
    if (scene) body.Scene = scene;
    return this.request("ListSeatInfoUsages", body);
  }
  // ============ Agent Plan 用量 (AFP) ============
  /** 个人版 AFP 额度用量 */
  getAFPUsage() {
    return this.request("GetAFPUsage", {});
  }
  /** 企业版席位 AFP 额度用量 */
  getSeatAFPUsage(seatIds) {
    return this.request("GetSeatAFPUsage", { SeatIDs: seatIds });
  }
  // ============ 模型调用明细 ============
  /** 个人版模型调用明细 */
  getUsageDetails(startDate, endDate, interval = "Day") {
    return this.request("GetUsageDetails", {
      QueryInterval: interval,
      Filter: { StartTime: startDate, EndTime: endDate }
    });
  }
  // ============ 模型限流 ============
  /** 查询模型限流 */
  listModelRateLimit(names) {
    return this.request("ListModelRateLimit", { FoundationModelNames: names ?? [] });
  }
}
class UsageMonitor {
  constructor(keyManager, seats, settings) {
    this.timer = null;
    this.snapshots = /* @__PURE__ */ new Map();
    this.lastError = /* @__PURE__ */ new Map();
    this.keyManager = keyManager;
    this.seats = seats;
    this.settings = settings;
  }
  setSettings(settings) {
    this.settings = settings;
    if (this.timer) {
      this.stop();
      this.start();
    }
  }
  setSeats(seats) {
    this.seats = seats;
  }
  /** 注册每次刷新完成后的回调 (告警评估 / 快照推送) */
  setOnRefresh(cb) {
    this.onRefresh = cb;
  }
  getSnapshots() {
    return Array.from(this.snapshots.values());
  }
  getSnapshot(seatId) {
    return this.snapshots.get(seatId);
  }
  start() {
    this.stop();
    this.tick().catch(() => {
    });
    this.timer = setInterval(() => {
      this.tick().catch(() => {
      });
    }, this.settings.pollInterval);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  /** 刷新一次并触发 onRefresh 回调 (定时轮询与手动刷新共用同一条链路) */
  async tick() {
    const snaps = await this.refreshAll();
    this.onRefresh?.(snaps);
    return snaps;
  }
  /** 刷新所有用量 */
  async refreshAll() {
    const accounts = this.keyManager.list();
    const results = [];
    for (const account of accounts) {
      const client = new VolcApiClient({ accessKey: account.accessKey, secretKey: account.secretKey });
      const accountSeats = this.seats.filter((s) => s.accountId === account.id);
      const manualSeats = accountSeats.filter((s) => s.seatId.startsWith("manual-"));
      const enterpriseSeats = accountSeats.filter((s) => !s.seatId.startsWith("manual-"));
      if (account.edition === "personal") {
        let agentAfp = null;
        let afpError = "";
        try {
          agentAfp = await client.getAFPUsage();
          console.log("[monitor] getAFPUsage OK:", JSON.stringify(agentAfp).slice(0, 200));
        } catch (e) {
          afpError = e.message;
          console.error("[monitor] getAFPUsage failed:", afpError);
        }
        let codingPlan = null;
        try {
          codingPlan = await client.getPersonalPlan("CodingPlan");
          console.log("[monitor] getPersonalPlan(Coding) OK:", codingPlan?.Status);
        } catch (e) {
          console.error("[monitor] getPersonalPlan(Coding) failed:", e.message);
        }
        for (const seat of manualSeats) {
          if (seat.scene === "agent_plan") {
            if (agentAfp) {
              results.push({
                seatId: seat.seatId,
                accountId: account.id,
                timestamp: Date.now(),
                afpFiveHour: parseAfpWindow(agentAfp.AFPFiveHour),
                afpDaily: parseAfpWindow(agentAfp.AFPDaily),
                afpWeekly: parseAfpWindow(agentAfp.AFPWeekly),
                afpMonthly: parseAfpWindow(agentAfp.AFPMonthly)
              });
            } else {
              results.push({
                seatId: seat.seatId,
                accountId: account.id,
                timestamp: Date.now(),
                error: `Agent Plan 查询失败: ${afpError}`
              });
            }
          } else if (seat.scene === "coding_plan") {
            const snap = {
              seatId: seat.seatId,
              accountId: account.id,
              timestamp: Date.now()
            };
            if (codingPlan && codingPlan.Status === "Running") {
              snap.info = `${codingPlan.PlanType} 套餐生效中`;
              try {
                const usage = await client.getCodingPlanUsage();
                for (const q of usage.QuotaUsage ?? []) {
                  const lv = (q.Level || "").toLowerCase();
                  const resetMs = q.ResetTimestamp > 0 ? q.ResetTimestamp * 1e3 : void 0;
                  if (["session", "5-hour", "five_hour", "5h"].includes(lv)) {
                    snap.shortTermUsage = q.Percent;
                    snap.shortTermResetTime = resetMs;
                  } else if (["weekly", "week"].includes(lv)) {
                    snap.weeklyUsage = q.Percent;
                    snap.weeklyResetTime = resetMs;
                  } else if (["monthly", "month"].includes(lv)) {
                    snap.monthlyUsage = q.Percent;
                    snap.monthlyResetTime = resetMs;
                  }
                }
                console.log("[monitor] coding plan usage:", JSON.stringify(usage));
              } catch (e) {
                console.error("[monitor] GetCodingPlanUsage failed:", e.message);
                snap.info = `${codingPlan.PlanType} 套餐生效中（用量查询暂不可用）`;
              }
            } else if (codingPlan) {
              snap.info = `${codingPlan.PlanType} 套餐已过期`;
            } else {
              snap.info = "未开通 Coding Plan";
            }
            results.push(snap);
          }
        }
        continue;
      }
      const codingSeats = enterpriseSeats.filter((s) => s.scene === "coding_plan");
      if (codingSeats.length > 0) {
        try {
          const seatIds = codingSeats.map((s) => s.seatId);
          const resp = await client.listSeatInfoUsages(seatIds, "coding_plan");
          for (const item of resp.Items || []) {
            results.push({
              seatId: item.SeatID,
              accountId: account.id,
              timestamp: Date.now(),
              shortTermUsage: item.ShortTermUsage,
              weeklyUsage: item.WeeklyUsage,
              monthlyUsage: item.MonthlyUsage,
              shortTermResetTime: item.ShortTermResetMilestone,
              weeklyResetTime: item.WeeklyResetMilestone,
              monthlyResetTime: item.MonthlyResetMilestone
            });
          }
        } catch (e) {
          for (const seat of codingSeats) {
            try {
              const usage = await client.getSeatInfoUsage(seat.seatId, "coding_plan");
              results.push({
                seatId: seat.seatId,
                accountId: account.id,
                timestamp: Date.now(),
                shortTermUsage: usage.ShortTermUsage,
                weeklyUsage: usage.WeeklyUsage,
                monthlyUsage: usage.MonthlyUsage,
                shortTermResetTime: usage.ShortTermResetMilestone,
                weeklyResetTime: usage.WeeklyResetMilestone,
                monthlyResetTime: usage.MonthlyResetMilestone
              });
            } catch (e2) {
              results.push({ seatId: seat.seatId, accountId: account.id, timestamp: Date.now(), error: e2.message });
            }
          }
        }
      }
      const agentSeats = enterpriseSeats.filter((s) => s.scene === "agent_plan");
      if (agentSeats.length > 0) {
        try {
          const seatIds = agentSeats.map((s) => s.seatId);
          const resp = await client.getSeatAFPUsage(seatIds);
          for (const item of resp.SeatAFPUsages || []) {
            results.push({
              seatId: item.SeatID,
              accountId: account.id,
              timestamp: Date.now(),
              afpFiveHour: parseAfpWindow(item.AFPFiveHour),
              afpDaily: parseAfpWindow(item.AFPDaily),
              afpWeekly: parseAfpWindow(item.AFPWeekly),
              afpMonthly: parseAfpWindow(item.AFPMonthly)
            });
          }
        } catch (e) {
          for (const seat of agentSeats) {
            results.push({ seatId: seat.seatId, accountId: account.id, timestamp: Date.now(), error: e.message });
          }
        }
      }
    }
    for (const snap of results) {
      this.snapshots.set(snap.seatId, snap);
    }
    return results;
  }
  getError(seatId) {
    return this.lastError.get(seatId);
  }
}
function parseAfpWindow(w) {
  return {
    quota: parseFloat(w.Quota) || 0,
    used: parseFloat(w.Used) || 0,
    resetTime: w.ResetTime,
    subscribeTime: w.SubscribeTime
  };
}
class AlertEngine {
  // 已通知的 seatId+维度，避免重复
  constructor(settings) {
    this.notified = /* @__PURE__ */ new Set();
    this.settings = settings;
  }
  setSettings(settings) {
    this.settings = settings;
  }
  /** 计算单个席位的 5 小时用量百分比 */
  getFiveHourPercent(snap) {
    if (snap.afpFiveHour && snap.afpFiveHour.quota > 0) {
      return snap.afpFiveHour.used / snap.afpFiveHour.quota * 100;
    }
    return snap.shortTermUsage;
  }
  /** 获取席位的过期时间 (需要 seat 信息) */
  getExpireDays(seat) {
    return Math.ceil((seat.expiredTime - Date.now()) / (1e3 * 60 * 60 * 24));
  }
  /**
   * 评估所有席位，返回整体状态和决策
   */
  evaluate(snapshots, seats) {
    let worstStatus = "ok";
    let needSwitch = false;
    let switchFrom;
    let messages = [];
    for (const snap of snapshots) {
      if (snap.error) {
        worstStatus = "danger";
        messages.push(`${snap.seatId} 查询失败: ${snap.error}`);
        continue;
      }
      const seat = seats.find((s) => s.seatId === snap.seatId);
      const pct = this.getFiveHourPercent(snap);
      if (pct !== void 0) {
        if (pct >= this.settings.dangerThreshold) {
          worstStatus = "danger";
          this.notify(`${seat?.planType ?? ""} 席位 5h 用量已达 ${pct.toFixed(1)}%`, "danger");
          if (this.settings.autoSwitch && pct >= this.settings.autoSwitchThreshold) {
            needSwitch = true;
            switchFrom = snap.seatId;
          }
        } else if (pct >= this.settings.warnThreshold) {
          if (worstStatus === "ok") worstStatus = "warning";
          this.notify(`${seat?.planType ?? ""} 席位 5h 用量 ${pct.toFixed(1)}%`, "warning");
        }
      }
      if (seat) {
        const days = this.getExpireDays(seat);
        if (days <= this.settings.expireWarnDays && days >= 0) {
          if (worstStatus !== "danger") worstStatus = "warning";
          this.notify(`${seat.planType} 席位将在 ${days} 天后到期`, "warning");
        } else if (days < 0 && seat.billingStatus !== 2) {
          worstStatus = "danger";
        }
      }
    }
    return {
      status: worstStatus,
      needAutoSwitch: needSwitch,
      switchFromSeatId: switchFrom,
      message: messages.join("\n")
    };
  }
  /** 选择下一个可切换的席位 (5h 余量充足且未过期) */
  pickNextSeat(snapshots, seats, excludeSeatId) {
    const candidates = seats.filter((s) => {
      if (s.seatId === excludeSeatId) return false;
      if (s.billingStatus !== 2) return false;
      if (s.expiredTime < Date.now()) return false;
      const snap = snapshots.find((x) => x.seatId === s.seatId);
      if (!snap || snap.error) return false;
      const pct = this.getFiveHourPercent(snap);
      if (pct === void 0) return true;
      return pct < 50;
    });
    candidates.sort((a, b) => {
      const sa = snapshots.find((x) => x.seatId === a.seatId);
      const sb = snapshots.find((x) => x.seatId === b.seatId);
      const pa = this.getFiveHourPercent(sa) ?? 0;
      const pb = this.getFiveHourPercent(sb) ?? 0;
      return pa - pb;
    });
    return candidates[0];
  }
  notify(message, level) {
    const key = `${level}:${message}`;
    if (this.notified.has(key)) return;
    this.notified.add(key);
    setTimeout(() => this.notified.delete(key), 36e5);
    if (electron.Notification.isSupported()) {
      new electron.Notification({
        title: level === "danger" ? "火山 Token 告警" : "火山 Token 提醒",
        body: message,
        silent: false
      }).show();
    }
  }
}
const PLAN_BASE_URLS = {
  coding_plan: "https://ark.cn-beijing.volces.com/api/coding",
  agent_plan: "https://ark.cn-beijing.volces.com/api/plan"
};
const MODEL_TIERS = ["OPUS", "SONNET", "HAIKU", "FABLE"];
class ClaudeSettings {
  get filePath() {
    return node_path.join(node_os.homedir(), ".claude", "settings.json");
  }
  /** 读取 settings.json；文件不存在返回空对象，格式异常直接抛错 (绝不覆盖坏文件) */
  load() {
    if (!node_fs.existsSync(this.filePath)) return {};
    const settings = JSON.parse(node_fs.readFileSync(this.filePath, "utf-8"));
    if (typeof settings !== "object" || settings === null) {
      throw new Error("settings.json 格式异常，已中止写入");
    }
    return settings;
  }
  save(settings) {
    node_fs.writeFileSync(this.filePath, JSON.stringify(settings, null, 2));
  }
  /**
   * 切换激活 Key: 写 token、按套餐选接入地址，模型有值时同步模型变量
   * @param scene 席位套餐类型，决定 ANTHROPIC_BASE_URL
   * @param apiKey 新 Key
   * @param model 可选模型名，空则保留 settings.json 现有模型
   * @since 2026-10-08
   */
  switchKey(scene, apiKey, model) {
    const settings = this.load();
    const env = settings.env ??= {};
    env.ANTHROPIC_AUTH_TOKEN = apiKey;
    env.ANTHROPIC_BASE_URL = PLAN_BASE_URLS[scene];
    if (model) this.applyModel(env, model);
    this.save(settings);
  }
  /** 只切换模型 (保留当前 token / 接入地址) */
  setModel(model) {
    const settings = this.load();
    this.applyModel(settings.env ??= {}, model);
    this.save(settings);
  }
  /** 当前 settings.json 生效的模型名 */
  getCurrentModel() {
    try {
      return this.load().env?.ANTHROPIC_MODEL;
    } catch {
      return void 0;
    }
  }
  applyModel(env, model) {
    env.ANTHROPIC_MODEL = model;
    for (const tier of MODEL_TIERS) {
      env[`ANTHROPIC_DEFAULT_${tier}_MODEL`] = model;
      env[`ANTHROPIC_DEFAULT_${tier}_MODEL_NAME`] = model;
    }
  }
}
function registerIpcHandlers(store2, monitor2, alertEngine2, getMainWindow, getAllWindows) {
  const claudeSettings = new ClaudeSettings();
  function broadcast(channel, payload) {
    for (const win of getAllWindows()) {
      win.webContents.send(channel, payload);
    }
  }
  electron.ipcMain.handle("account:list", () => {
    return store2.listAccounts().map((a) => ({ ...a, accessKey: mask(a.accessKey), secretKey: "***" }));
  });
  electron.ipcMain.handle("account:add", (_e, account) => {
    const a = store2.addAccount(account);
    return { ...a, accessKey: mask(a.accessKey), secretKey: "***" };
  });
  electron.ipcMain.handle("account:update", (_e, id, patch) => {
    const a = store2.updateAccount(id, patch);
    if (!a) return null;
    return { ...a, accessKey: mask(a.accessKey), secretKey: "***" };
  });
  electron.ipcMain.handle("account:remove", (_e, id) => {
    store2.removeSeatsByAccount(id);
    return store2.removeAccount(id);
  });
  electron.ipcMain.handle("seat:list", () => store2.getSeats());
  electron.ipcMain.handle("seat:sync", async (_e, accountId) => {
    const account = store2.keyManager.get(accountId);
    if (!account) throw new Error("账号不存在");
    const client = new VolcApiClient({ accessKey: account.accessKey, secretKey: account.secretKey });
    const seats = [];
    try {
      const resp = await client.listSeatInfos("coding_plan_enterprise");
      for (const s of resp.Data || []) {
        seats.push({
          seatId: s.SeatID,
          accountId,
          apiKey: s.ApiKey,
          apiKeySid: s.ApiKeySID,
          planType: s.BizInfo,
          scene: "coding_plan",
          expiredTime: s.ExpiredTime,
          billingStatus: s.BillingStatus,
          userName: s.IdentityDetail
        });
      }
    } catch {
    }
    try {
      const resp = await client.listSeatInfos("agent_plan_enterprise");
      for (const s of resp.Data || []) {
        seats.push({
          seatId: s.SeatID,
          accountId,
          apiKey: s.ApiKey,
          apiKeySid: s.ApiKeySID,
          planType: s.BizInfo,
          scene: "agent_plan",
          expiredTime: s.ExpiredTime,
          billingStatus: s.BillingStatus,
          userName: s.IdentityDetail
        });
      }
    } catch {
    }
    for (const seat of seats) {
      store2.upsertSeat(seat);
    }
    monitor2.setSeats(store2.getSeats());
    return seats;
  });
  electron.ipcMain.handle("seat:add", async (_e, seat) => {
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let planType = "Unknown";
    let expiredTime = Date.now() + 30 * 864e5;
    try {
      const account = store2.keyManager.list().find((a) => a.id === seat.accountId);
      if (account) {
        const client = new VolcApiClient({ accessKey: account.accessKey, secretKey: account.secretKey });
        const planName = seat.scene === "coding_plan" ? "CodingPlan" : "AgentPlan";
        const plan = await client.getPersonalPlan(planName);
        if (plan.PlanType) planType = plan.PlanType;
        if (plan.EndTime) {
          const t = new Date(plan.EndTime).getTime();
          if (!isNaN(t)) expiredTime = t;
        }
      }
    } catch (e) {
      console.error("[ipc] auto-fetch plan info failed:", e.message);
    }
    const newSeat = {
      seatId: id,
      accountId: seat.accountId,
      apiKey: seat.apiKey,
      planType,
      scene: seat.scene,
      expiredTime,
      billingStatus: 2,
      userName: seat.remark
    };
    store2.upsertSeat(newSeat);
    monitor2.setSeats(store2.getSeats());
    return newSeat;
  });
  electron.ipcMain.handle("seat:remove", (_e, seatId) => {
    const seats = store2.getSeats().filter((s) => s.seatId !== seatId);
    store2.setSeats(seats);
    monitor2.setSeats(seats);
    return true;
  });
  electron.ipcMain.handle("usage:list", () => monitor2.getSnapshots());
  electron.ipcMain.handle("usage:refresh", async () => {
    return await monitor2.tick();
  });
  monitor2.setOnRefresh((snaps) => {
    try {
      const decision = alertEngine2.evaluate(snaps, store2.getSeats());
      broadcast("status:update", decision.status);
      if (decision.needAutoSwitch && decision.switchFromSeatId) {
        const next = alertEngine2.pickNextSeat(snaps, store2.getSeats(), decision.switchFromSeatId);
        if (next) switchToSeat(next);
      }
    } catch (e) {
      console.error("[monitor] alertEngine error:", e.message);
    }
    broadcast("usage:update", snaps);
  });
  electron.ipcMain.handle("env:switch", async (_e, seatId) => {
    const seat = store2.getSeats().find((s) => s.seatId === seatId);
    if (!seat) throw new Error("席位不存在");
    await switchToSeat(seat);
    await monitor2.tick();
    return true;
  });
  electron.ipcMain.handle("model:list", async () => {
    const accounts = store2.listAccounts();
    if (accounts.length === 0) throw new Error("请先添加火山账号");
    const activeSeat = store2.getSeats().find((s) => s.seatId === store2.getActiveSeatId());
    const account = accounts.find((a) => a.id === activeSeat?.accountId) ?? accounts[0];
    const client = new VolcApiClient({ accessKey: account.accessKey, secretKey: account.secretKey });
    const resp = await client.listModelRateLimit();
    return resp.Items.map((i) => i.FoundationModelName);
  });
  electron.ipcMain.handle("model:switch", (_e, model) => {
    store2.setSettings({ model });
    claudeSettings.setModel(model);
    return true;
  });
  electron.ipcMain.handle("model:current", () => claudeSettings.getCurrentModel() ?? "");
  electron.ipcMain.handle("settings:get", () => store2.getSettings());
  electron.ipcMain.handle("settings:set", (_e, settings) => {
    store2.setSettings(settings);
    const s = store2.getSettings();
    alertEngine2.setSettings(s);
    monitor2.setSettings(s);
    return s;
  });
  electron.ipcMain.handle("active:get", () => store2.getActiveSeatId());
  electron.ipcMain.handle("window:toggle", () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isVisible()) win.hide();
    else {
      win.show();
      win.focus();
    }
  });
  function switchToSeat(seat) {
    const model = store2.getSettings().model || claudeSettings.getCurrentModel();
    claudeSettings.switchKey(seat.scene, seat.apiKey, model);
    store2.setActiveSeatId(seat.seatId);
    broadcast("active:changed", seat.seatId);
  }
}
function mask(s) {
  if (!s || s.length <= 8) return "****";
  return s.slice(0, 4) + "****" + s.slice(-4);
}
let ballWindow = null;
let panelWindow = null;
let tray = null;
let monitor;
let alertEngine;
let store;
const BALL_SIZE = 80;
function createBallWindow() {
  const { width: sw, height: sh } = electron.screen.getPrimaryDisplay().workAreaSize;
  ballWindow = new electron.BrowserWindow({
    width: BALL_SIZE,
    height: BALL_SIZE,
    x: sw - BALL_SIZE - 20,
    y: sh - BALL_SIZE - 20,
    show: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  ballWindow.setAlwaysOnTop(true, "screen-saver");
  if (process.env["ELECTRON_RENDERER_URL"]) {
    ballWindow.loadURL(process.env["ELECTRON_RENDERER_URL"] + "#ball");
  } else {
    ballWindow.loadFile(path.join(__dirname, "../renderer/index.html"), { hash: "ball" });
  }
  ballWindow.setIgnoreMouseEvents(false);
  ballWindow.on("closed", () => {
    ballWindow = null;
  });
}
function createPanelWindow() {
  const { width: sw, height: sh } = electron.screen.getPrimaryDisplay().workAreaSize;
  panelWindow = new electron.BrowserWindow({
    width: 380,
    height: 520,
    x: sw - 380 - 20,
    y: sh - 520 - BALL_SIZE - 30,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  panelWindow.setAlwaysOnTop(true, "screen-saver");
  if (process.env["ELECTRON_RENDERER_URL"]) {
    panelWindow.loadURL(process.env["ELECTRON_RENDERER_URL"] + "#panel");
  } else {
    panelWindow.loadFile(path.join(__dirname, "../renderer/index.html"), { hash: "panel" });
  }
  panelWindow.on("blur", () => {
    panelWindow?.hide();
  });
  panelWindow.on("closed", () => {
    panelWindow = null;
  });
}
function positionPanel() {
  if (!ballWindow || !panelWindow) return;
  const [bx, by] = ballWindow.getPosition();
  const { width: sw, height: sh } = electron.screen.getPrimaryDisplay().workAreaSize;
  let px = bx - 380 + BALL_SIZE;
  let py = by - 520 + BALL_SIZE;
  if (px < 10) px = bx + BALL_SIZE + 10;
  if (py < 10) py = by + BALL_SIZE + 10;
  if (py + 520 > sh) py = sh - 520 - 10;
  if (px + 380 > sw) px = sw - 380 - 10;
  panelWindow.setPosition(px, py);
}
function togglePanel() {
  if (!panelWindow || !ballWindow) return;
  if (panelWindow.isVisible()) {
    panelWindow.hide();
  } else {
    positionPanel();
    panelWindow.show();
    panelWindow.focus();
  }
}
function createTray() {
  const iconPng = "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIGNIUk0AAHolAACAgwAA+f8AAIDpAAB1MAAA6mAAADqYAAAXb5Lf3gAAABVJREFUGNNjYBgJo4JgQAELxjAJRiUAARIMAVMcBpRTGTsAAAAASUVORK5CYII=";
  const icon = electron.nativeImage.createFromDataURL(`data:image/png;base64,${iconPng}`);
  tray = new electron.Tray(icon);
  const contextMenu = electron.Menu.buildFromTemplate([
    { label: "显示面板", click: () => togglePanel() },
    { label: "立即刷新用量", click: () => monitor.refreshAll() },
    { type: "separator" },
    { label: "退出", click: () => {
      electron.app.exit();
    } }
  ]);
  tray.setToolTip("火山 Token 监控");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => togglePanel());
}
electron.ipcMain.on("ball:move", (_e, dx, dy) => {
  if (!ballWindow) return;
  const [x, y] = ballWindow.getPosition();
  const { width: sw, height: sh } = electron.screen.getPrimaryDisplay().workAreaSize;
  const nx = Math.max(0, Math.min(sw - BALL_SIZE, x + dx));
  const ny = Math.max(0, Math.min(sh - BALL_SIZE, y + dy));
  ballWindow.setPosition(nx, ny);
  if (panelWindow?.isVisible()) positionPanel();
});
electron.ipcMain.on("panel:toggle", () => togglePanel());
electron.ipcMain.on("panel:close", () => panelWindow?.hide());
electron.app.whenReady().then(() => {
  store = new AppStore();
  const settings = store.getSettings();
  alertEngine = new AlertEngine(settings);
  monitor = new UsageMonitor(store.keyManager, store.getSeats(), settings);
  createBallWindow();
  createPanelWindow();
  createTray();
  registerIpcHandlers(
    store,
    monitor,
    alertEngine,
    () => panelWindow,
    () => [ballWindow, panelWindow].filter((w) => !!w)
  );
  monitor.start();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createBallWindow();
      createPanelWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
});
electron.app.on("before-quit", () => {
  monitor.stop();
});
