import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function WorkoutTemplateScreen() {
  const { templateId } = useLocalSearchParams<{ templateId: string }>();

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Workout Mode</ThemedText>
        <ThemedText type="subtitle">Template {templateId}</ThemedText>
      </View>
      <ThemedText>Workout logging goes here.</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
  },
  header: {
    gap: 8,
  },
});
