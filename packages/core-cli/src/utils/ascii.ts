import chalk from "chalk";

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
  console.log(chalk.bold.white("    🧠 CORE - Contextual Observation & Recall Engine \n"));
}
