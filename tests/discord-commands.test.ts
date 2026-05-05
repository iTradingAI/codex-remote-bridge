import { describe, expect, it } from "vitest";
import {
  buildCodexSlashCommands,
  shouldIgnoreMessage
} from "../src/providers/discord/discord-provider.js";

interface CommandOptionWithChildren {
  name: string;
  description: string;
  options?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

describe("Discord slash commands", () => {
  it("registers parameterized commands with Chinese descriptions", () => {
    const [command] = buildCodexSlashCommands();

    expect(command.name).toBe("codex");
    expect(command.description).toContain("本机");

    const options = command.options as CommandOptionWithChildren[] | undefined;
    const bind = options?.find((option) => option.name === "bind");
    expect(bind?.description).toContain("绑定");
    expect(bind?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "path",
          description: expect.stringContaining("绝对路径"),
          required: true
        }),
        expect.objectContaining({
          name: "alias",
          description: expect.stringContaining("别名"),
          required: false
        })
      ])
    );

    const send = options?.find((option) => option.name === "send");
    expect(send?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "text",
          description: expect.stringContaining("发送给 Codex"),
          required: true
        })
      ])
    );
  });

  it("ignores bot and Discord system messages", () => {
    expect(
      shouldIgnoreMessage({
        author: { bot: false },
        system: true
      } as Parameters<typeof shouldIgnoreMessage>[0])
    ).toBe(true);
    expect(
      shouldIgnoreMessage({
        author: { bot: true },
        system: false
      } as Parameters<typeof shouldIgnoreMessage>[0])
    ).toBe(true);
    expect(
      shouldIgnoreMessage({
        author: { bot: false },
        system: false
      } as Parameters<typeof shouldIgnoreMessage>[0])
    ).toBe(false);
  });
});
