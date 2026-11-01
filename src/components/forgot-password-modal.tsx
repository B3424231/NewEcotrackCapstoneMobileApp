import { Colors as UiColors, type AppColors, Spacing } from '@/constants/theme';
import { useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from './themed-text';

import { useSettings } from '@/context/settings-context';
import { AppIcon } from '@/components/app-icon';
import {
  verifyUserForPasswordReset,
  requestPasswordRecovery,
  clearSession,
  resetUserPassword,
  saveRememberedCredentials,
  AppUser,
} from '@/services/supabase';

// 2D line-art eye vector icons using base64-encoded SVG data URIs
const EYE_ICON_SVG =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2YjcyODAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMSAxMnM0LTggMTEtOCAxMSA4IDExIDgtNCA4LTExIDgtMTEtOC0xMS04eiIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjMiLz48L3N2Zz4=';
const EYE_SLASH_ICON_SVG =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2YjcyODAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTcuOTQgMTcuOTRBMTAuMDcgMTAuMDcgMCAwIDEgMTIgMjBjLTcgMC0xMS04LTExLThhMTguNDUgMTguNDUgMCAwIDEgNS4wNi01Ljk0TTkuOSA0LjI0QTkuMTIgOS4xMiAwIDAgMSAxMiA0YzcgMCAxMSA4IDExIDhhMTguNSAxOC41IDAgMCAxLTIuMTYgMy4xOW0tNi43Mi0xLjA3YTMgMyAwIDEgMS00LjI0LTQuMjQiLz48bGluZSB4MT0iMSIgeTE9IjEiIHgyPSIyMyIgeTI9IjIzIi8+PC9zdmc+';

// Key / Shield / Success vector SVG
const KEY_SHIELD_SVG =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMxMGI5ODEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTIgMjJzOC00IDgtMTBWNWwtOC0zLTggM3Y3YzAgNiA4IDEwIDggMTB6Ii8+PHBhdGggZD0ibTkgMTIgMiAyIDQtNCIvPjwvc3ZnPg==';

export interface ForgotPasswordModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (user: AppUser, rememberMe?: boolean) => void;
}

type ModalStep = 'verify' | 'reset' | 'remember';

export function ForgotPasswordModal({ visible, onClose, onSuccess }: ForgotPasswordModalProps) {
  const { effectiveTheme, colors } = useSettings();
  const styles = themedStyles[effectiveTheme];
  const isDark = effectiveTheme === 'dark';

  const [step, setStep] = useState<ModalStep>('verify');

  // Step 1 states: Account Verification
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Step 2 states: New Password
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Verified User Info
  const [verifiedUser, setVerifiedUser] = useState<AppUser | null>(null);
  const [verifiedUserType, setVerifiedUserType] = useState<'admin' | 'staff'>('staff');
  const [matchedName, setMatchedName] = useState('');
  const [matchedPhone, setMatchedPhone] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  const placeholderColor = isDark ? '#64748b' : '#9ca3af';

  const resetInternalState = () => {
    setStep('verify');
    setUsername('');
    setPhoneNumber('');
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setVerifiedUser(null);
    setVerifiedUserType('staff');
    setMatchedName('');
    setMatchedPhone('');
    setLoading(false);
    setErrorMessage('');
    setInfoMessage('');
  };

  const handleClose = () => {
    if (verifiedUser) void clearSession();
    resetInternalState();
    onClose();
  };

  // Step 1: Verify username and phone number
  const handleVerifyAccount = async () => {
    setErrorMessage('');
    setInfoMessage('');
    if (!username.trim()) {
      setErrorMessage('Please enter your account email.');
      return;
    }
    if (!phoneNumber.trim()) {
      setLoading(true);
      const sent = await requestPasswordRecovery(username);
      setLoading(false);
      if (sent.success) {
        setInfoMessage('We sent a 6-digit code to your email. Check your inbox or spam folder.');
      } else {
        setErrorMessage(sent.error || 'Unable to send recovery code.');
      }
      return;
    }

    setLoading(true);
    const result = await verifyUserForPasswordReset(username, phoneNumber);
    setLoading(false);

    if (!result.success || !result.user) {
      setErrorMessage(result.error || 'No matching account found. Please check your details.');
      return;
    }

    // Success -> proceed to Step 2
    setVerifiedUser(result.user);
    setVerifiedUserType(result.userType || 'staff');
    setMatchedName(result.matchedName || result.user.name || username);
    setMatchedPhone(result.matchedPhone || result.user.phone || phoneNumber);
    setStep('reset');
  };

  // Step 2: Reset password
  const handleResetPassword = async () => {
    setErrorMessage('');
    if (!newPassword) {
      setErrorMessage('New password is required.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }
    if (!verifiedUser?.id) {
      setErrorMessage('User session expired. Please verify your account again.');
      setStep('verify');
      return;
    }

    setLoading(true);
    const result = await resetUserPassword(verifiedUser.id, verifiedUserType, newPassword);
    setLoading(false);

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to update password. Please try again.');
      return;
    }

    // Advance to Step 3: Remember Login prompt
    setStep('remember');
  };

  // Step 3: Handle Remember Me selection & direct login to Dashboard
  const handleRememberChoice = async (remember: boolean) => {
    if (!verifiedUser) return;

    if (remember) {
      await saveRememberedCredentials(verifiedUser.phone || verifiedUser.name, true);
    }

    const finalUser = verifiedUser;
    resetInternalState();
    onClose();
    // Direct navigation to Dashboard / Home via login success
    onSuccess(finalUser, remember);
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, isDark && styles.modalCardDark]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollInner}
          >
            {/* Step Progress Pills */}
            <View style={styles.stepProgressRow}>
              <View
                style={[
                  styles.stepPill,
                  styles.stepPillActive,
                  isDark && styles.stepPillActiveDark,
                ]}
              >
                <ThemedText style={styles.stepPillTextActive}>1. Verify</ThemedText>
              </View>
              <View
                style={[
                  styles.stepPill,
                  (step === 'reset' || step === 'remember') && styles.stepPillActive,
                  (step === 'reset' || step === 'remember') && isDark && styles.stepPillActiveDark,
                ]}
              >
                <ThemedText
                  style={
                    step === 'reset' || step === 'remember'
                      ? styles.stepPillTextActive
                      : styles.stepPillText
                  }
                >
                  2. Password
                </ThemedText>
              </View>
              <View
                style={[
                  styles.stepPill,
                  step === 'remember' && styles.stepPillActive,
                  step === 'remember' && isDark && styles.stepPillActiveDark,
                ]}
              >
                <ThemedText
                  style={step === 'remember' ? styles.stepPillTextActive : styles.stepPillText}
                >
                  3. Access
                </ThemedText>
              </View>
            </View>

            {/* Info / Success Container */}
            {infoMessage ? (
              <View style={[styles.infoContainer, isDark && styles.infoContainerDark]}>
                <AppIcon name="check-circle" size={14} color={isDark ? '#34d399' : '#059669'} />
                <ThemedText style={[styles.infoText, isDark && styles.infoTextDark]}>
                  {infoMessage}
                </ThemedText>
              </View>
            ) : null}

            {/* Error Container */}
            {errorMessage ? (
              <View style={[styles.errorContainer, isDark && styles.errorContainerDark]}>
                <ThemedText style={[styles.errorText, isDark && styles.errorTextDark]}>
                  {errorMessage}
                </ThemedText>
              </View>
            ) : null}

            {/* STEP 1: Verify Username & Phone Number */}
            {step === 'verify' && (
              <View style={styles.stepContent}>
                <View style={styles.headerSection}>
                  <View style={[styles.iconBadge, isDark && styles.iconBadgeDark]}>
                    <AppIcon name="search" size={24} color={colors.emerald} />
                  </View>
                  <ThemedText style={[styles.modalTitle, isDark && styles.modalTitleDark]}>
                    Forgot Password
                  </ThemedText>
                  <ThemedText style={[styles.modalSubtitle, isDark && styles.modalSubtitleDark]}>
                    Request a code by email, then enter it to verify your account.
                  </ThemedText>
                </View>

                <View style={styles.formGroup}>
                  <View style={styles.inputGroup}>
                    <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>
                      Email Address
                    </ThemedText>
                    <TextInput
                      style={[styles.inputField, isDark && styles.inputFieldDark]}
                      value={username}
                      onChangeText={setUsername}
                      placeholder="Enter your account email"
                      placeholderTextColor={placeholderColor}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>
                      Recovery Code
                    </ThemedText>
                    <TextInput
                      style={[styles.inputField, isDark && styles.inputFieldDark]}
                      value={phoneNumber}
                      onChangeText={setPhoneNumber}
                      placeholder="Enter the 6-digit emailed recovery code"
                      placeholderTextColor={placeholderColor}
                      keyboardType="number-pad"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {Boolean(infoMessage) && (
                      <Pressable
                        onPress={async () => {
                          setLoading(true);
                          setErrorMessage('');
                          const sent = await requestPasswordRecovery(username);
                          setLoading(false);
                          if (sent.success) {
                            setInfoMessage('A new recovery code has been sent to your email.');
                          } else {
                            setErrorMessage(sent.error || 'Unable to resend recovery code.');
                          }
                        }}
                        disabled={loading}
                        style={{ alignSelf: 'flex-end', marginTop: 4 }}
                      >
                        <ThemedText style={{ fontSize: 11.5, color: colors.emerald, fontWeight: '700' }}>
                          Resend recovery code
                        </ThemedText>
                      </Pressable>
                    )}
                  </View>
                </View>

                <Pressable
                  onPress={handleVerifyAccount}
                  disabled={loading}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.buttonPressed,
                    loading && { opacity: 0.7 },
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color={UiColors[effectiveTheme].onPrimary} size="small" />
                  ) : (
                    <ThemedText style={styles.primaryButtonText}>{phoneNumber.trim() ? 'VERIFY ACCOUNT' : 'SEND RECOVERY CODE'}</ThemedText>
                  )}
                </Pressable>

                <Pressable
                  onPress={handleClose}
                  style={({ pressed }) => [styles.cancelButton, pressed && { opacity: 0.6 }]}
                >
                  <ThemedText style={[styles.cancelButtonText, isDark && styles.cancelButtonTextDark]}>
                    Cancel & Back to Login
                  </ThemedText>
                </Pressable>
              </View>
            )}

            {/* STEP 2: New Password & Confirm Password */}
            {step === 'reset' && (
              <View style={styles.stepContent}>
                <View style={styles.headerSection}>
                  <View style={[styles.iconBadgeSuccess, isDark && styles.iconBadgeSuccessDark]}>
                    <Image
                      source={{ uri: KEY_SHIELD_SVG }}
                      style={{ width: 28, height: 28 }}
                      contentFit="contain"
                    />
                  </View>
                  <ThemedText style={[styles.modalTitle, isDark && styles.modalTitleDark]}>
                    Set New Password
                  </ThemedText>
                  <ThemedText style={[styles.modalSubtitle, isDark && styles.modalSubtitleDark]}>
                    Account verified! Create a new secure password for your account.
                  </ThemedText>
                </View>

                {/* Verified Account Badge */}
                <View style={[styles.verifiedBadge, isDark && styles.verifiedBadgeDark]}>
                  <ThemedText style={styles.verifiedBadgeIcon}>✓</ThemedText>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.verifiedName, isDark && styles.verifiedNameDark]}>
                      {matchedName}
                    </ThemedText>
                    <ThemedText style={[styles.verifiedPhone, isDark && styles.verifiedPhoneDark]}>
                      Phone: {matchedPhone}
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.formGroup}>
                  {/* New Password */}
                  <View style={styles.inputGroup}>
                    <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>
                      New Password
                    </ThemedText>
                    <View style={styles.passwordWrapper}>
                      <TextInput
                        style={[
                          styles.inputField,
                          styles.passwordInput,
                          isDark && styles.inputFieldDark,
                        ]}
                        value={newPassword}
                        onChangeText={setNewPassword}
                        placeholder="••••••••"
                        placeholderTextColor={placeholderColor}
                        secureTextEntry={!showNewPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Pressable
                        style={styles.eyeButton}
                        onPress={() => setShowNewPassword(!showNewPassword)}
                      >
                        <Image
                          source={{ uri: showNewPassword ? EYE_SLASH_ICON_SVG : EYE_ICON_SVG }}
                          style={styles.eyeIcon}
                          tintColor={isDark ? '#94a3b8' : '#6b7280'}
                        />
                      </Pressable>
                    </View>
                  </View>

                  {/* Confirm Password */}
                  <View style={styles.inputGroup}>
                    <ThemedText style={[styles.inputLabel, isDark && styles.inputLabelDark]}>
                      Confirm New Password
                    </ThemedText>
                    <View style={styles.passwordWrapper}>
                      <TextInput
                        style={[
                          styles.inputField,
                          styles.passwordInput,
                          isDark && styles.inputFieldDark,
                        ]}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        placeholder="••••••••"
                        placeholderTextColor={placeholderColor}
                        secureTextEntry={!showConfirmPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Pressable
                        style={styles.eyeButton}
                        onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                      >
                        <Image
                          source={{ uri: showConfirmPassword ? EYE_SLASH_ICON_SVG : EYE_ICON_SVG }}
                          style={styles.eyeIcon}
                          tintColor={isDark ? '#94a3b8' : '#6b7280'}
                        />
                      </Pressable>
                    </View>
                  </View>
                </View>

                <Pressable
                  onPress={handleResetPassword}
                  disabled={loading}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.buttonPressed,
                    loading && { opacity: 0.7 },
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color={UiColors[effectiveTheme].onPrimary} size="small" />
                  ) : (
                    <ThemedText style={styles.primaryButtonText}>UPDATE PASSWORD</ThemedText>
                  )}
                </Pressable>

                <Pressable
                  onPress={() => setStep('verify')}
                  style={({ pressed }) => [styles.cancelButton, pressed && { opacity: 0.6 }]}
                >
                  <ThemedText style={[styles.cancelButtonText, isDark && styles.cancelButtonTextDark]}>
                    ← Back to Verification
                  </ThemedText>
                </Pressable>
              </View>
            )}

            {/* STEP 3: Remember It or Not? -> Direct to Dashboard */}
            {step === 'remember' && (
              <View style={styles.stepContent}>
                <View style={styles.headerSection}>
                  <View style={[styles.iconBadgeSuccess, isDark && styles.iconBadgeSuccessDark]}>
                    <AppIcon name="shield" size={28} color={colors.emerald} />
                  </View>
                  <ThemedText style={[styles.modalTitle, isDark && styles.modalTitleDark]}>
                    Password Updated!
                  </ThemedText>
                  <ThemedText style={[styles.modalSubtitle, isDark && styles.modalSubtitleDark]}>
                    Would you like EcoTrack to remember your account on this device so you stay
                    signed in?
                  </ThemedText>
                </View>

                {/* Convenience info callout */}
                <View style={[styles.rememberCard, isDark && styles.rememberCardDark]}>
                  <AppIcon name="bolt" size={20} color={UiColors[effectiveTheme].warning} />
                  <View style={{ flex: 1 }}>
                    <ThemedText
                      style={[styles.rememberCardTitle, isDark && styles.rememberCardTitleDark]}
                    >
                      Instant Dashboard Access
                    </ThemedText>
                    <ThemedText
                      style={[styles.rememberCardSub, isDark && styles.rememberCardSubDark]}
                    >
                      You will be directed straight into the live telemetry dashboard.
                    </ThemedText>
                  </View>
                </View>

                <View style={{ gap: Spacing.two, marginTop: Spacing.two }}>
                  {/* Yes: Remember me */}
                  <Pressable
                    onPress={() => handleRememberChoice(true)}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      styles.rememberYesButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText style={styles.primaryButtonText}>
                      ✓  YES, REMEMBER ME & GO HOME
                    </ThemedText>
                  </Pressable>

                  {/* No: Don't remember */}
                  <Pressable
                    onPress={() => handleRememberChoice(false)}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      isDark && styles.secondaryButtonDark,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText
                      style={[styles.secondaryButtonText, isDark && styles.secondaryButtonTextDark]}
                    >
                      NO, JUST CONTINUE TO DASHBOARD
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(6, 46, 30, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.backgroundElement,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: colors.panelBorder,
    paddingHorizontal: 24,
    paddingVertical: 26,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    ...Platform.select({
      android: {
        elevation: 16,
      },
    }),
  },
  modalCardDark: {
    backgroundColor: colors.backgroundElement,
    borderColor: colors.panelBorder,
    shadowColor: "#0f172a",
  },
  scrollInner: {
    alignItems: 'stretch',
  },
  stepProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: Spacing.three,
  },
  stepPill: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: colors.backgroundSelected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPillActive: {
    backgroundColor: colors.accentSurface,
    borderWidth: 1,
    borderColor: colors.emerald,
  },
  stepPillActiveDark: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.emerald,
  },
  stepPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  stepPillTextActive: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.emerald,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  iconBadge: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.accentSurface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  iconBadgeDark: {
    backgroundColor: '#0f172a',
    borderColor: colors.border,
  },
  iconBadgeSuccess: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.accentSurface,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  iconBadgeSuccessDark: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  modalTitleDark: {
    color: colors.onPrimary,
  },
  modalSubtitle: {
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    fontWeight: '500',
    paddingHorizontal: 8,
  },
  modalSubtitleDark: {
    color: colors.textMuted,
  },
  stepContent: {
    gap: Spacing.three,
  },
  formGroup: {
    gap: Spacing.two,
  },
  inputGroup: {
    gap: 5,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingLeft: 2,
  },
  inputLabelDark: {
    color: colors.textMuted,
  },
  inputField: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: colors.background,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.text,
    ...Platform.select({
      web: {
        outlineStyle: 'none',
      },
    }),
  },
  inputFieldDark: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    color: colors.text,
  },
  passwordWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 44,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeIcon: {
    width: 18,
    height: 18,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.accentSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 4,
  },
  verifiedBadgeDark: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  verifiedBadgeIcon: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.emerald,
    backgroundColor: colors.accentSurface,
    width: 26,
    height: 26,
    borderRadius: 13,
    textAlign: 'center',
    lineHeight: 25,
  },
  verifiedName: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  verifiedNameDark: {
    color: colors.emerald,
  },
  verifiedPhone: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.text,
  },
  verifiedPhoneDark: {
    color: colors.textMuted,
  },
  rememberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.accentSurface,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    borderRadius: 16,
    padding: 14,
    marginBottom: 4,
  },
  rememberCardDark: {
    backgroundColor: '#0f172a',
    borderColor: colors.panelBorder,
  },
  rememberCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  rememberCardTitleDark: {
    color: colors.text,
  },
  rememberCardSub: {
    fontSize: 11.5,
    color: colors.text,
    lineHeight: 16,
    marginTop: 2,
  },
  rememberCardSubDark: {
    color: colors.textMuted,
  },
  primaryButton: {
    backgroundColor: colors.primaryFill,
    borderRadius: 13,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
    }),
  },
  rememberYesButton: {
    backgroundColor: colors.primaryFill,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  secondaryButton: {
    backgroundColor: colors.backgroundSelected,
    borderRadius: 13,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
    }),
  },
  secondaryButtonDark: {
    backgroundColor: colors.backgroundSelected,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  secondaryButtonTextDark: {
    color: colors.textMuted,
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 6,
    marginTop: 2,
  },
  cancelButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  cancelButtonTextDark: {
    color: colors.textMuted,
  },
  errorContainer: {
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: Spacing.two,
    marginBottom: Spacing.two,
  },
  errorContainerDark: {
    backgroundColor: colors.errorSurface,
    borderColor: colors.border,
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorTextDark: {
    color: colors.error,
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.accentSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: Spacing.two,
    marginBottom: Spacing.two,
  },
  infoContainerDark: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.border,
  },
  infoText: {
    color: colors.emerald,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    lineHeight: 16,
  },
  infoTextDark: {
    color: colors.emerald,
  },
});
const themedStyles = { light: createStyles(UiColors.light), dark: createStyles(UiColors.dark) };
