/** Compatibility entrypoint for frontend attendance contracts. */
export {
  ATTENDANCE_ACTION,
  ATTENDANCE_STATUS,
} from '../../contracts/index.js';
export type {
  AttendanceAction,
  AttendanceStatus,
  BulkClockInRequest,
  BulkClockInResponse,
  BulkClockOutRequest,
  BulkClockOutResponse,
  ClockInRequest,
  ClockOutRequest,
  ManualTimeEntryRequest,
  TimeEntry,
  UpdateTimeEntryRequest,
} from '../../contracts/index.js';

export type AttendanceMutation = 'clock-in' | 'clock-out';