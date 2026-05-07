import { describe, expect, it } from "vitest";
import { formatDoctorReport, type DoctorReport } from "../src/cli/doctor.js";

describe("doctor report formatting", () => {
  it("renders a Chinese healthy report with JSON fallback hint", () => {
    const report: DoctorReport = {
      ok: true,
      configPath: "config/bridge.local.json",
      machineId: "macbookpro",
      checks: [
        {
          id: "config",
          label: "配置文件",
          status: "ok",
          detail: "已读取 config/bridge.local.json"
        }
      ],
      suggestions: [],
      nextCommands: ["crb logs --config config/bridge.local.json --errors"],
      sessions: []
    };

    const formatted = formatDoctorReport(report);

    expect(formatted).toContain("CRB 诊断报告（macbookpro）");
    expect(formatted).toContain("整体状态：正常");
    expect(formatted).toContain("[OK] 配置文件");
    expect(formatted).toContain("crb doctor --config config/bridge.local.json --json");
  });

  it("renders actionable suggestions for failed checks", () => {
    const report: DoctorReport = {
      ok: false,
      configPath: "config/bridge.local.json",
      checks: [
        {
          id: "discord-api",
          label: "Discord 连接",
          status: "fail",
          detail: "Connect Timeout Error"
        },
        {
          id: "daemon",
          label: "后台驻留",
          status: "warn",
          detail: "未检测到后台 tmux 会话"
        }
      ],
      suggestions: [
        "在 .env.local 设置 CRB_PROXY 后重试。",
        "运行 crb daemon --config config/bridge.local.json。"
      ],
      nextCommands: ["crb register --config config/bridge.local.json"],
      sessions: []
    };

    const formatted = formatDoctorReport(report);

    expect(formatted).toContain("整体状态：需要处理");
    expect(formatted).toContain("[FAIL] Discord 连接：Connect Timeout Error");
    expect(formatted).toContain("下一步建议：");
    expect(formatted).toContain("在 .env.local 设置 CRB_PROXY 后重试。");
    expect(formatted).toContain("crb register --config config/bridge.local.json");
  });
});
