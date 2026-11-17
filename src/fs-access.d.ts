// File System Access API members not yet in lib.dom (Chromium only).
interface FileSystemHandlePermissionDescriptor { mode?: 'read' | 'readwrite' }
interface FileSystemDirectoryHandle {
  queryPermission(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}
interface Window { showDirectoryPicker(opts?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle> }
