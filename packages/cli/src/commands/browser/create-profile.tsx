import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { ThemeContext } from '@/hooks/useTheme';
import { themeContextValue } from '@/config/themes';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import { createProfile } from '@/utils/agent-browser';

export const args = zod.tuple([zod.string().describe('Profile name')]);

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

export default function BrowserCreateProfile({ args: [name] }: Props) {
	const [status, setStatus] = useState<'creating' | 'success' | 'error'>('creating');
	const [profilePath, setProfilePath] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		const result = createProfile(name);

		if (result.success) {
			setProfilePath(result.path);
			setStatus('success');
		} else {
			setError(result.error || 'Unknown error');
			setStatus('error');
		}
	}, [name]);

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{status === 'creating' ? (
				<Text dimColor>Creating profile {name}...</Text>
			) : status === 'success' ? (
				<SuccessMessage message={`Profile "${name}" created at ${profilePath}`} />
			) : status === 'error' ? (
				<ErrorMessage message={`Failed to create profile: ${error}`} />
			) : null}
		</ThemeContext.Provider>
	);
}
