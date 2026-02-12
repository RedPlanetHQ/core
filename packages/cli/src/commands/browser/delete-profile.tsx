import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { deleteProfile } from '@/utils/agent-browser';

export const args = zod.tuple([zod.string().describe('Profile name')]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

export default function BrowserDeleteProfile({ args: [name] }: Props) {
	const [status, setStatus] = useState<'deleting' | 'success' | 'error'>('deleting');
	const [error, setError] = useState('');

	useEffect(() => {
		const result = deleteProfile(name);

		if (result.success) {
			setStatus('success');
		} else {
			setError(result.error || 'Unknown error');
			setStatus('error');
		}
	}, [name]);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'deleting' ? (
				<Text dimColor>Deleting profile {name}...</Text>
			) : status === 'success' ? (
				<SuccessMessage message={`Profile "${name}" deleted`} />
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to delete profile: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
