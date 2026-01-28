import {TitledBox, titleStyles} from '@mishieck/ink-titled-box';
import {Text, Box} from 'ink';

import {useTheme} from '@/hooks/useTheme';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';

export default function InfoMessage({
	message,
	hideTitle = false,
	hideBox = false,
}: {
	message: string;
	hideTitle?: boolean;
	hideBox?: boolean;
}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	return (
		<>
			{hideBox ? (
				<Box width={boxWidth} flexDirection="column" marginBottom={1}>
					<Text color={colors.white}>{message}</Text>
				</Box>
			) : hideTitle ? (
				<Box
					borderStyle="round"
					width={boxWidth}
					borderColor={colors.white}
					paddingX={2}
					paddingY={0}
					flexDirection="column"
				>
					<Text color={colors.white}>{message}</Text>
				</Box>
			) : (
				<TitledBox
					key={colors.primary}
					borderStyle="round"
					titles={['Info']}
					titleStyles={titleStyles.pill}
					width={boxWidth}
					borderColor={colors.white}
					paddingX={2}
					paddingY={1}
					flexDirection="column"
				>
					<Text color={colors.white}>{message}</Text>
				</TitledBox>
			)}
		</>
	);
}
