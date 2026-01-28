import { TitledBox, titleStyles } from '@mishieck/ink-titled-box';
import { Text, Box } from 'ink';
import { memo } from 'react';

import { useTheme } from '@/hooks/useTheme';
import { useTerminalWidth } from '@/hooks/useTerminalWidth';

export default memo(function WarningMessage({
	message,
	hideTitle = false,
	hideBox = false,
}: {
	message: string;
	hideTitle?: boolean;
	hideBox?: boolean;
}) {
	const boxWidth = useTerminalWidth();
	const { colors } = useTheme();
	return (
		<>
			{hideBox ? (
				<Box width={boxWidth} flexDirection="column" marginBottom={1}>
					<Text color={colors.warning}>{message}</Text>
				</Box>
			) : hideTitle ? (
				<Box
					borderStyle="round"
					width={boxWidth}
					borderColor={colors.warning}
					paddingX={2}
					paddingY={0}
					flexDirection="column"
				>
					<Text color={colors.warning}>{message}</Text>
				</Box>
			) : (
				<TitledBox
					key={colors.primary}
					borderStyle="round"
					titles={['Warning']}
					titleStyles={titleStyles.pill}
					width={boxWidth}
					borderColor={colors.warning}
					paddingX={2}
					paddingY={1}
					flexDirection="column"
				>
					<Text color={colors.warning}>{message}</Text>
				</TitledBox>
			)}
		</>
	);
});
