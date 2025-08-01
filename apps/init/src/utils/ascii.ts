import chalk from "chalk";
import { VERSION } from "../cli/version.js";

export function printCoreBrainLogo(): void {
  const brain = `
    ██████╗ ██████╗ ██████╗ ███████╗
   ██╔════╝██╔═══██╗██╔══██╗██╔════╝
   ██║     ██║   ██║██████╔╝█████╗  
   ██║     ██║   ██║██╔══██╗██╔══╝  
   ╚██████╗╚██████╔╝██║  ██║███████╗
    ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝
                                    
         o     o     o
       o   o---o---o   o
      o---o   o   o---o---o
     o   o---o---o---o   o
      o---o   o   o---o---o
       o   o---o---o   o
         o     o     o

  `;

  console.log(chalk.cyan(brain));
  console.log(
    chalk.bold.white(
      `    🧠 CORE - Contextual Observation & Recall Engine ${VERSION ? chalk.gray(`(${VERSION})`) : ""}\n`
    )
  );
}
