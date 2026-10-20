param([long]$WindowHandle,[uint32]$OwnerProcess,[int]$Edge,[int]$X,[int]$Y,[int]$Width,[int]$Height)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MirrorPanelResizeTest {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint process);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h,uint message,IntPtr w,ref Rect r,uint flags,uint timeout,out IntPtr result);
 public static void Resize(long handle,uint owner,int edge,int x,int y,int width,int height) {
  uint actual;var h=new IntPtr(handle);GetWindowThreadProcessId(h,out actual);
  if(actual!=owner)throw new InvalidOperationException("Window does not belong to this test process");
  SetThreadDpiAwarenessContext(new IntPtr(-4));
  var r=new Rect {Left=x,Top=y,Right=x+width,Bottom=y+height};IntPtr result;
  if(SendMessageTimeout(h,0x0214,new IntPtr(edge),ref r,2,5000,out result)==IntPtr.Zero)throw new InvalidOperationException("WM_SIZING timed out");
 }
}
'@
[MirrorPanelResizeTest]::Resize($WindowHandle,$OwnerProcess,$Edge,$X,$Y,$Width,$Height)
