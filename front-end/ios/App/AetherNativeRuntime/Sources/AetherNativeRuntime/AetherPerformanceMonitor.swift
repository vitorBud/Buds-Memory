import Darwin
import Foundation

enum AetherPerformanceMonitor {
    private static let peakLock = NSLock()
    private nonisolated(unsafe) static var observedPeakBytes: UInt64 = 0

    static func snapshot() -> (residentBytes: UInt64, observedPeakBytes: UInt64, cpuSeconds: Double) {
        let resident = residentMemoryBytes()
        peakLock.lock()
        observedPeakBytes = max(observedPeakBytes, resident)
        let peak = observedPeakBytes
        peakLock.unlock()
        return (resident, peak, processCPUSeconds())
    }

    private static func residentMemoryBytes() -> UInt64 {
        var info = mach_task_basic_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info_data_t>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? UInt64(info.resident_size) : 0
    }

    private static func processCPUSeconds() -> Double {
        var value = timespec()
        guard clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &value) == 0 else { return 0 }
        return Double(value.tv_sec) + Double(value.tv_nsec) / 1_000_000_000
    }
}
