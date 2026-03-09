const { z } = require("zod");
const memory = require("../../brain/memory");

module.exports = {
  schema: z.object({}),
  name: "listCommands",
  description: "List all saved custom voice commands",
  tags: ["command", "list", "shortcuts"],

  returnType: "data",
  marker: "silently",
  ui: "command-list",

  examples: [
    { user: "show my custom commands", action: "[action: listCommands]" },
    { user: "show my Aliases", action: "[action: listCommands]" },
  ],

  async handler() {
    const cmds = memory.getCustomCommands();
    if (cmds.length === 0) {
      return JSON.stringify({
        customCommands: [],
        message: "No custom commands saved yet.",
      });
    }
    return JSON.stringify({ customCommands: cmds, count: cmds.length });
  },
};
