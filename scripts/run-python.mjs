import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const venvWin = path.join(rootDir, "apps", "api", ".venv312", "Scripts", "python.exe");
const venvPosix = path.join(rootDir, "apps", "api", ".venv312", "bin", "python");

let pythonCmd = "python";
if (fs.existsSync(venvWin)) {
  pythonCmd = venvWin;
} else if (fs.existsSync(venvPosix)) {
  pythonCmd = venvPosix;
}

const args = process.argv.slice(2);
const child = spawn(pythonCmd, args, { stdio: "inherit", shell: false });
child.on("exit", (code) => {
  process.exit(code ?? 0);
});
