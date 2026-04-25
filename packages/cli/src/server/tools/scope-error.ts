import {GatewayErrorCode} from '@redplanethq/gateway-protocol';

export function folderScopeError(target: string, scope: string) {
	return {
		ok: false as const,
		error: {
			code: GatewayErrorCode.FOLDER_SCOPE_DENIED,
			message: `Path "${target}" is not inside a registered folder with scope "${scope}". Run \`corebrain folder add\`.`,
		},
	};
}
