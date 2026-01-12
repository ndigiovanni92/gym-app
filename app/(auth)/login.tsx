import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/src/lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert('Missing info', 'Please enter an email and password.');
      return;
    }

    setLoading(true);

    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      Alert.alert('Authentication error', error.message);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Welcome back</ThemedText>
        <ThemedText type="subtitle">Sign in to continue</ThemedText>
      </View>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <ThemedText style={styles.label}>Email</ThemedText>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            style={styles.input}
            value={email}
          />
        </View>

        <View style={styles.inputGroup}>
          <ThemedText style={styles.label}>Password</ThemedText>
          <TextInput
            autoCapitalize="none"
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>

        <Pressable disabled={loading} onPress={handleAuth} style={styles.primaryButton}>
          <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>
            {loading ? 'Loading…' : isSignUp ? 'Create account' : 'Sign in'}
          </ThemedText>
        </Pressable>

        <Pressable disabled={loading} onPress={() => setIsSignUp((prev) => !prev)}>
          <ThemedText style={styles.secondaryAction}>
            {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 32,
    justifyContent: 'center',
  },
  header: {
    gap: 8,
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d0d5dd',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  primaryButton: {
    backgroundColor: '#111827',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
  },
  secondaryAction: {
    textAlign: 'center',
    color: '#475467',
  },
});
