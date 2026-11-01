import { Colors as UiColors, type AppColors, Spacing } from '@/constants/theme';
import { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from './themed-text';

import { useSettings } from '@/context/settings-context';

// 2D line-art eye vector icons using base64-encoded SVG data URIs
const EYE_ICON_SVG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2YjcyODAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMSAxMnM0LTggMTEtOCAxMSA4IDExIDgtNCA4LTExIDgtMTEtOC0xMS04eiIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjMiLz48L3N2Zz4=';
const EYE_SLASH_ICON_SVG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2YjcyODAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTcuOTQgMTcuOTRBMTAuMDcgMTAuMDcgMCAwIDEgMTIgMjBjLTcgMC0xMS04LTExLThhMTguNDUgMTguNDUgMCAwIDEgNS4wNi01Ljk0TTkuOSA0LjI0QTkuMTIgOS4xMiAwIDAgMSAxMiA0YzcgMCAxMSA4IDExIDhhMTguNSAxOC41IDAgMCAxLTIuMTYgMy4xOW0tNi43Mi0xLjA3YTMgMyAwIDEgMS00LjI0LTQuMjQiLz48bGluZSB4MT0iMSIgeTE9IjEiIHgyPSIyMyIgeTI9IjIzIi8+PC9zdmc+';

import {
  authenticateUser,
  getRememberedCredentials,
  saveRememberedCredentials,
  clearRememberedCredentials,
  AppUser,
} from '@/services/supabase';
import { ArchivedAccountModal } from './archived-account-modal';
import { ForgotPasswordModal } from './forgot-password-modal';

interface AuthScreenProps {
  onLoginSuccess: (user?: AppUser) => void;
}

type InputFieldType = 'phone' | 'password';

export function AuthScreen({ onLoginSuccess }: AuthScreenProps) {
  const { effectiveTheme } = useSettings();
  const styles = themedStyles[effectiveTheme];
  const isDark = effectiveTheme === 'dark';

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [focusedField, setFocusedField] = useState<InputFieldType | null>(null);

  // Forgot Password modal state
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);

  // Archival modal state
  const [showArchivedModal, setShowArchivedModal] = useState(false);
  const [archivedData, setArchivedData] = useState<{
    userName?: string;
    userRole?: string;
    reason?: string;
    notes?: string;
    archivedAt?: string;
  } | null>(null);

  // Preload remembered credentials on initial mount
  useEffect(() => {
    if (typeof getRememberedCredentials === 'function') {
      getRememberedCredentials()
        .then((creds) => {
          if (creds && creds.rememberMe) {
            if (creds.identifier) {
              setPhone(creds.identifier);
            }
            setRememberMe(true);
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleLogin = async () => {
    setErrorMessage('');
    
    if (!phone.trim()) {
      setErrorMessage('Phone number, email, or username is required.');
      return;
    }
    if (!password) {
      setErrorMessage('Password is required.');
      return;
    }

    setLoading(true);
    const result = await authenticateUser(phone, password);
    setLoading(false);

    if (result.isArchived) {
      setArchivedData({
        userName: result.user?.name || 'Technician',
        userRole: result.user?.role || 'HVAC / Aircon Technician',
        reason: result.archiveReason || 'Administrative / Compliance Deactivation',
        notes: result.archiveNotes || '',
        archivedAt: result.archivedAt || '',
      });
      setShowArchivedModal(true);
      return;
    }

    if (!result.success || !result.user) {
      setErrorMessage(result.error || 'Invalid credentials.');
      return;
    }

    // Persist or clear Remember Me credentials
    if (rememberMe) {
      await saveRememberedCredentials(phone, true);
    } else {
      await clearRememberedCredentials();
    }

    onLoginSuccess(result.user);
  };

  const placeholderColor = isDark ? '#64748b' : '#9ca3af';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[
        styles.keyboardContainer,
        { backgroundColor: isDark ? '#06130d' : '#062e1e' },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.cardContainer}>
          {/* Main Card Wrapper (Adapts to Dark / Light Theme) */}
          <View style={[styles.whiteCard, isDark && styles.darkCard]}>
            
            {/* Logo Section */}
            <View style={styles.logoContainer}>
              <Image
                source={require('@/assets/images/ecoTrack.png')}
                style={styles.logoImage}
                contentFit="contain"
              />
              <ThemedText style={[styles.titleText, isDark && styles.titleTextDark]}>
                EcoTrack
              </ThemedText>
              <ThemedText style={[styles.subtitleText, isDark && styles.subtitleTextDark]}>
                Welcome back! Please login to your account.
              </ThemedText>
            </View>

            {/* Error Message */}
            {errorMessage ? (
              <View style={[styles.errorContainer, isDark && styles.errorContainerDark]}>
                <ThemedText style={[styles.errorText, isDark && styles.errorTextDark]}>
                  {errorMessage}
                </ThemedText>
              </View>
            ) : null}

            {/* Inputs Form */}
            <View style={styles.formContainer}>
              {/* Phone / Identifier Input */}
              <View style={styles.inputGroup}>
                <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>
                  Phone, Email, or Username
                </ThemedText>
                <TextInput
                  style={[
                    styles.inputField,
                    isDark && styles.inputFieldDark,
                    focusedField === 'phone' &&
                      (isDark ? styles.inputFieldFocusedDark : styles.inputFieldFocused),
                  ]}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Username, email, or phone"
                  placeholderTextColor={placeholderColor}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onFocus={() => setFocusedField('phone')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              {/* Password Input */}
              <View style={styles.inputGroup}>
                <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>
                  Password
                </ThemedText>
                <View style={styles.passwordWrapper}>
                  <TextInput
                    style={[
                      styles.inputField,
                      styles.passwordInput,
                      isDark && styles.inputFieldDark,
                      focusedField === 'password' &&
                        (isDark ? styles.inputFieldFocusedDark : styles.inputFieldFocused),
                    ]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                    placeholderTextColor={placeholderColor}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                  />
                  <Pressable
                    style={styles.eyeButton}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Image
                      source={{ uri: showPassword ? EYE_SLASH_ICON_SVG : EYE_ICON_SVG }}
                      style={styles.eyeIcon}
                      tintColor={isDark ? '#94a3b8' : '#6b7280'}
                    />
                  </Pressable>
                </View>
              </View>

              {/* Options Row: Remember Me & Forgot Password */}
              <View style={styles.optionsRow}>
                {/* Remember Me Checkbox */}
                <Pressable
                  onPress={() => setRememberMe(!rememberMe)}
                  style={styles.rememberMeContainer}
                  hitSlop={8}
                >
                  <View
                    style={[
                      styles.checkbox,
                      isDark && styles.checkboxDark,
                      rememberMe &&
                        (isDark ? styles.checkboxCheckedDark : styles.checkboxChecked),
                    ]}
                  >
                    {rememberMe && <ThemedText style={styles.checkmarkIcon}>✓</ThemedText>}
                  </View>
                  <ThemedText
                    style={[styles.rememberMeText, isDark && styles.rememberMeTextDark]}
                  >
                    Remember me
                  </ThemedText>
                </Pressable>

                {/* Forgot Password Link */}
                <Pressable
                  onPress={() => setShowForgotPasswordModal(true)}
                  style={({ pressed }) => [
                    styles.forgotPasswordButton,
                    pressed && { opacity: 0.6 },
                  ]}
                  hitSlop={8}
                >
                  <ThemedText
                    style={[
                      styles.forgotPasswordText,
                      isDark && styles.forgotPasswordTextDark,
                    ]}
                  >
                    Forgot Password?
                  </ThemedText>
                </Pressable>
              </View>

              {/* Login Submit Button */}
              <Pressable
                onPress={handleLogin}
                disabled={loading}
                style={({ pressed }) => [
                  styles.submitButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                {loading ? (
                  <ActivityIndicator color={UiColors[effectiveTheme].onPrimary} />
                ) : (
                  <ThemedText style={styles.submitButtonText}>
                    LOGIN
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Forgot Password Flow Modal */}
      <ForgotPasswordModal
        visible={showForgotPasswordModal}
        onClose={() => setShowForgotPasswordModal(false)}
        onSuccess={(user, isRemembered) => {
          setShowForgotPasswordModal(false);
          if (isRemembered) {
            setRememberMe(true);
          }
          onLoginSuccess(user);
        }}
      />

      {/* Archived Account Reason Modal */}
      <ArchivedAccountModal
        visible={showArchivedModal}
        userName={archivedData?.userName}
        userRole={archivedData?.userRole}
        reason={archivedData?.reason}
        notes={archivedData?.notes}
        archivedAt={archivedData?.archivedAt}
        isLoginAttempt
        onAcknowledge={() => setShowArchivedModal(false)}
      />
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  keyboardContainer: {
    flex: 1,
    backgroundColor: '#062e1e',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  cardContainer: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whiteCard: {
    width: '100%',
    backgroundColor: colors.backgroundElement,
    borderRadius: 36,
    paddingHorizontal: 28,
    paddingVertical: 36,
    alignItems: 'stretch',
    borderWidth: 1.5,
    borderColor: colors.panelBorder,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 1,
    shadowRadius: 36,
    ...Platform.select({
      android: {
        elevation: 16,
      },
    }),
  },
  darkCard: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
    shadowColor: "#0f172a",
    shadowOpacity: 0.6,
    shadowRadius: 30,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: Spacing.four,
  },
  logoImage: {
    width: 80,
    height: 80,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: Spacing.three,
  },
  titleText: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  titleTextDark: {
    color: colors.onPrimary,
  },
  subtitleText: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    fontWeight: '500',
    paddingHorizontal: Spacing.two,
  },
  subtitleTextDark: {
    color: colors.textMuted,
  },
  errorContainer: {
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: Spacing.two,
    marginBottom: Spacing.three,
  },
  errorContainerDark: {
    backgroundColor: colors.errorSurface,
    borderColor: colors.border,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorTextDark: {
    color: colors.error,
  },
  formContainer: {
    gap: Spacing.three,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingLeft: 4,
  },
  inputLabelDark: {
    color: colors.textMuted,
  },
  inputField: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: colors.background,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    ...Platform.select({
      web: {
        outlineStyle: 'none',
        transition: 'border-color 0.2s ease-in-out, background-color 0.2s ease-in-out',
      },
    }),
  },
  inputFieldDark: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    color: colors.text,
  },
  inputFieldFocused: {
    borderColor: colors.emerald,
    backgroundColor: colors.backgroundElement,
  },
  inputFieldFocusedDark: {
    borderColor: colors.emerald,
    backgroundColor: '#0f172a',
  },
  passwordWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 48,
  },
  eyeButton: {
    position: 'absolute',
    right: Spacing.three,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeIcon: {
    width: 20,
    height: 20,
  },
  submitButton: {
    backgroundColor: colors.primaryFill,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    ...Platform.select({
      android: {
        elevation: 4,
      },
      web: {
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      },
    }),
  },
  buttonPressed: {
    transform: [{ scale: 0.96 }],
  },
  submitButtonText: {
    color: colors.onPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
    }),
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDark: {
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  checkboxChecked: {
    backgroundColor: colors.primaryFill,
    borderColor: colors.border,
  },
  checkboxCheckedDark: {
    backgroundColor: colors.primaryFill,
    borderColor: colors.border,
  },
  checkmarkIcon: {
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 13,
  },
  rememberMeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4b5563',
  },
  rememberMeTextDark: {
    color: colors.textMuted,
  },
  forgotPasswordButton: {
    paddingVertical: 2,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
    }),
  },
  forgotPasswordText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.emerald,
  },
  forgotPasswordTextDark: {
    color: colors.emerald,
  },
});
const themedStyles = { light: createStyles(UiColors.light), dark: createStyles(UiColors.dark) };
