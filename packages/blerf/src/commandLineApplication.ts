
interface CommandOption {
    name: string;
    shortName?: string;
    type: "enum"|"string"|"commandArgument";
    enum?: string[];
    default?: string;
    required?: boolean;
}

interface Command {
    methodName: string;
    commandName: string;
    options: CommandOption[];
    description: string;
}

interface CommandLineApplicationConstructor extends Function {
    programName: string;
    commands: { [key: string]: Command };
}

export function Command(commandName: string, description: string, ...opts: CommandOption[]) {
    return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const constructor = target.constructor as CommandLineApplicationConstructor;
        const commands = constructor.commands || {};
        commands[commandName] = {
            methodName: propertyKey,
            commandName: commandName,
            options: opts,
            description: description,
        };
        constructor.commands = commands;
    }
}

export abstract class CommandLineApplication {

    async runCommandLineApplicationAndExit(argv: string[]): Promise<void> {
        try {
            const exitValue = await this.runCommandLineApplication(argv);
            process.exit(exitValue);
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    }

    async runCommandLineApplication(argv: string[]): Promise<number> {
        const constructor = this.constructor as CommandLineApplicationConstructor;
        const commands = constructor.commands || {};

        // 1. find if there is a command match = first 
        let command: Command|undefined = commands[argv[0]];

        if (command === undefined) {
            this.usage();
            return 0;
        }

        const argumentObject: { [key: string]: any} = {};
        const args: string[] = [];
        for (var i = 1; i < argv.length; i++) {
            const arg = argv[i];
            if (arg === "--") {
                args.push(...argv.slice(i + 1));
                break;
            } else if (arg.startsWith("--")) {
                const option = command.options.find(o => o.name === arg.substr(2));
                if (!option) {
                    console.error("Invalid option", arg);
                    process.exit(1);
                    return 1;
                }

                i++;
                argumentObject[option.name] = argv[i];
            } else if (arg.startsWith("-")) {
                const option = command.options.find(o => o.shortName === arg.substr(2));
                if (!option) {
                    console.error("Invalid option", arg);
                    return 1;
                }

                i++;
                argumentObject[option.name] = argv[i];
            } else {
                console.error("Invalid argument " + arg);
                return 1;
            }
        }

        await (this as any)[command.methodName](argumentObject, args);
        return 0;
    }

    usage() {
        const constructor = this.constructor as CommandLineApplicationConstructor;
        const commands = constructor.commands || {};
        console.log(constructor.programName + " <command> [options]");
        console.log();
        console.log("Commands:");
        for (let commandName of Object.keys(commands)) {
            const command = commands[commandName];
            let commandText = constructor.programName + " " + commandName;
            for (let option of command.options) {
                commandText += " ";
                if (option.required !== true) {
                    commandText += "[";
                }

                if (option.type === "commandArgument") {
                    commandText += "<" + option.name + ">";
                } else if (option.type === "enum") {
                    const enumValues = option.enum || [];
                    commandText += "--" + option.name + " <" + enumValues.join("|") + ">";
                } else {
                    commandText += "--" + option.name + " <" + option.type + ">";
                }
                // commandText += " [--" + option.name + " <" + option.type + ">]";
                if (option.required !== true) {
                    commandText += "]";
                }
            }

            // commandText += " " + command.description;
            console.log("  " + commandText);
            if (command.description) {
                // console.log();
                console.log("  " + command.description)
            }
            console.log();
        }

    }
}
