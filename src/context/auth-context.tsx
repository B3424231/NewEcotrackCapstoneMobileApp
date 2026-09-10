import React, { createContext, useContext, useState, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  AppUser,
  getSavedSession,
  clearSession,
  updateStaffOnlineStatus,
  fetchLiveMaintenanceReports,
  subscribeToStaffMember,
  isStaffArchived,
} from '@/services/supabase';
import { checkAndDispatchMaintenanceReminders } from '@/services/mobile-notifications';

export interface AuthContextType {
  isAuthenticated: boolean;
  userId: string;
  userEmail: string;
  userName: string;
  userRole: string;
  userPhone: string;
  userAssignment: string;
  setUserAssignment: (assignment: string) => void;
  userType: 'admin' | 'staff';
  userAvatar: 'default' | 'male' | 'female' | 'custom';
  userCustomPhotoUri: string | null;
  isArchived: boolean;
  archiveReason: string | null;
  archiveNotes: string | null;
  archivedAt: string | null;
  remotelyLoggedOut: boolean;
  acknowledgeArchived: () => void;
  acknowledgeRemoteLogout: () => void;
  login: (user?: AppUser) => void;
  logout: () => void;
  updateUserProfile: (
    name: string,
    role: string,
    phone: string,
    avatar: 'default' | 'male' | 'female' | 'custom',
    uri: string | null,
    email?: string,
    assignment?: string
  ) => void;
}

export const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  userId: '',
  userEmail: '',
  userName: '',
  userRole: '',
  userPhone: '',
  userAssignment: 'Unassigned',
  setUserAssignment: () => {},
  userType: 'staff',
  userAvatar: 'default',
  userCustomPhotoUri: null,
  isArchived: false,
  archiveReason: null,
  archiveNotes: null,
  archivedAt: null,
  remotelyLoggedOut: false,
  acknowledgeArchived: () => {},
  acknowledgeRemoteLogout: () => {},
  login: () => {},
  logout: () => {},
  updateUserProfile: () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('HVAC / Aircon Technician');
  const [userPhone, setUserPhone] = useState('');
  const [userAssignment, setUserAssignment] = useState('Unassigned');
  const [userType, setUserType] = useState<'admin' | 'staff'>('staff');
  const [userAvatar, setUserAvatar] = useState<'default' | 'male' | 'female' | 'custom'>('default');
  const [userCustomPhotoUri, setUserCustomPhotoUri] = useState<string | null>(null);

  // Archival & Remote Logout states
  const [isArchived, setIsArchived] = useState(false);
  const [archiveReason, setArchiveReason] = useState<string | null>(null);
  const [archiveNotes, setArchiveNotes] = useState<string | null>(null);
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  const [remotelyLoggedOut, setRemotelyLoggedOut] = useState(false);

  useEffect(() => {
    // Restore session on app launch
    getSavedSession().then((savedUser) => {
      if (savedUser) {
        setUserId(savedUser.id);
        setUserEmail(savedUser.email);
        setUserName(savedUser.name);
        setUserRole(savedUser.role || 'HVAC / Aircon Technician');
        setUserPhone(savedUser.phone);
        if (savedUser.assignment) setUserAssignment(savedUser.assignment);
        setUserType(savedUser.userType);
        if (savedUser.avatar) setUserAvatar(savedUser.avatar);
        if (savedUser.photoUrl) setUserCustomPhotoUri(savedUser.photoUrl);

        if (savedUser.isArchived) {
          setIsArchived(true);
          setArchiveReason(savedUser.archiveReason || 'Administrative / Compliance Deactivation');
          setArchiveNotes(savedUser.archiveNotes || null);
          setArchivedAt(savedUser.archivedAt || null);
        }

        setIsAuthenticated(true);

        // Run proactive maintenance reminder check
        if (!savedUser.isArchived && typeof fetchLiveMaintenanceReports === 'function') {
          fetchLiveMaintenanceReports(savedUser.name)
            .then((reports) => {
              if (typeof checkAndDispatchMaintenanceReminders === 'function') {
                checkAndDispatchMaintenanceReminders(savedUser.name, reports);
              }
            })
            .catch(() => {});
        }
      }
    });
  }, []);

  // Real-time synchronization on current staff member (archival & admin force logout)
  useEffect(() => {
    if (!userId || userType === 'admin') return;

    const unsubscribe = subscribeToStaffMember(userId, (updatedStaff) => {
      const isNowArchived = isStaffArchived(updatedStaff);

      if (isNowArchived) {
        setIsArchived(true);
        setArchiveReason(updatedStaff.archive_reason || 'Administrative / Compliance Deactivation');
        setArchiveNotes(updatedStaff.archive_notes || null);
        setArchivedAt(updatedStaff.archived_at || updatedStaff.updated || null);
        return;
      }

      // Check if admin remotely forced logout from desktop
      const isRemoteLoggedOut =
        (updatedStaff.status === 'Offline' || updatedStaff.status === 'inactive' || (updatedStaff as any).force_logout === true) &&
        !isNowArchived;

      if (isRemoteLoggedOut && isAuthenticated) {
        setRemotelyLoggedOut(true);
        clearSession(userId);
        setIsAuthenticated(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [userId, userType, isAuthenticated]);

  // Synchronize Online status when app is brought to foreground
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (!userId || !isAuthenticated || isArchived) return;
      if (nextAppState === 'active') {
        updateStaffOnlineStatus(userId, true);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [userId, isAuthenticated, isArchived]);

  const handleLogin = (user?: AppUser) => {
    if (user) {
      setUserId(user.id);
      setUserEmail(user.email);
      setUserName(user.name);
      setUserRole(user.role || 'HVAC / Aircon Technician');
      setUserPhone(user.phone);
      if (user.assignment) setUserAssignment(user.assignment);
      setUserType(user.userType);
      if (user.avatar) setUserAvatar(user.avatar);
      if (user.photoUrl) setUserCustomPhotoUri(user.photoUrl);

      if (user.isArchived) {
        setIsArchived(true);
        setArchiveReason(user.archiveReason || 'Administrative / Compliance Deactivation');
        setArchiveNotes(user.archiveNotes || null);
        setArchivedAt(user.archivedAt || null);
      } else {
        setIsArchived(false);
        setArchiveReason(null);
        setArchiveNotes(null);
        setArchivedAt(null);
      }

      setRemotelyLoggedOut(false);

      // Ensure staff is marked Online in Supabase
      if (!user.isArchived) {
        updateStaffOnlineStatus(user.id || user.email, true);

        // Run proactive maintenance reminder check
        fetchLiveMaintenanceReports(user.name).then((reports) => {
          checkAndDispatchMaintenanceReminders(user.name, reports);
        });
      }
    }
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    const currentId = userId;
    await clearSession(currentId);
    setUserId('');
    setUserEmail('');
    setUserName('');
    setUserPhone('');
    setUserRole('HVAC / Aircon Technician');
    setUserAssignment('Unassigned');
    setUserAvatar('default');
    setUserCustomPhotoUri(null);
    setIsArchived(false);
    setArchiveReason(null);
    setArchiveNotes(null);
    setArchivedAt(null);
    setIsAuthenticated(false);
  };

  const acknowledgeArchived = async () => {
    const currentId = userId;
    await clearSession(currentId);
    setUserId('');
    setUserEmail('');
    setUserName('');
    setUserPhone('');
    setUserRole('HVAC / Aircon Technician');
    setUserAssignment('Unassigned');
    setUserAvatar('default');
    setUserCustomPhotoUri(null);
    setIsArchived(false);
    setArchiveReason(null);
    setArchiveNotes(null);
    setArchivedAt(null);
    setIsAuthenticated(false);
  };

  const acknowledgeRemoteLogout = () => {
    setRemotelyLoggedOut(false);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        userId,
        userEmail,
        userName,
        userRole,
        userPhone,
        userAssignment,
        setUserAssignment,
        userType,
        userAvatar,
        userCustomPhotoUri,
        isArchived,
        archiveReason,
        archiveNotes,
        archivedAt,
        remotelyLoggedOut,
        acknowledgeArchived,
        acknowledgeRemoteLogout,
        login: handleLogin,
        logout: handleLogout,
        updateUserProfile: (name, role, phone, avatar, uri, email, assignment) => {
          setUserName(name);
          setUserRole(role);
          setUserPhone(phone);
          setUserAvatar(avatar);
          setUserCustomPhotoUri(uri);
          if (email) setUserEmail(email);
          if (assignment) setUserAssignment(assignment);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

