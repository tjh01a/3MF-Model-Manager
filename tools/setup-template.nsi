Unicode true
SetCompressor /SOLID lzma

!include "MUI2.nsh"

!define APP_NAME "@@APP_NAME@@"
!define APP_VERSION "@@VERSION@@"
!define APP_EXE "@@APP_EXE@@"
!define APP_PUBLISHER "@@PUBLISHER@@"
!define APP_URL "@@APP_URL@@"
!define SRC_DIR "@@SRC_DIR@@"
!define ICON_FILE "@@ICON@@"
!define LICENSE_FILE "@@LICENSE@@"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

Name "${APP_NAME}"
OutFile "@@OUT_FILE@@"
InstallDir "$PROGRAMFILES64\${APP_NAME}"
InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show
BrandingText "${APP_NAME} ${APP_VERSION}"

!define MUI_ICON "${ICON_FILE}"
!define MUI_UNICON "${ICON_FILE}"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "欢迎安装 ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "这是一个本地 3MF 模型库工具：扫描、分类、预览、去重，一键送到切片软件。$\r$\n$\r$\n所有数据 100% 保存在你自己的电脑上，不会上传到任何服务器。$\r$\n$\r$\n点击「下一步」继续。"

!define MUI_LICENSEPAGE_TEXT_TOP "请阅读以下许可协议。"
!define MUI_LICENSEPAGE_TEXT_BOTTOM "继续安装即表示你接受以上条款。"

!define MUI_DIRECTORYPAGE_TEXT_TOP "请选择安装位置。如果不需要修改，点击「下一步」使用默认目录。"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSE_FILE}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "立即运行 ${APP_NAME}"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\使用说明.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "查看使用说明"
!define MUI_FINISHPAGE_LINK "项目主页（GitHub）"
!define MUI_FINISHPAGE_LINK_LOCATION "${APP_URL}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

Section "安装" SecInstall
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r "${SRC_DIR}\*.*"

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\uninstall.exe"
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  WriteUninstaller "$INSTDIR\uninstall.exe"

  SetRegView 64
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "URLInfoAbout" "${APP_URL}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "EstimatedSize" 276480
SectionEnd

Section "Uninstall"
  ExecWait 'taskkill /IM "${APP_EXE}" /F'

  MessageBox MB_YESNO|MB_ICONQUESTION "是否保留模型库数据？$\r$\n$\r$\n「是」= 只删除程序，保留 data 文件夹里的模型索引、缩略图和耗材库。$\r$\n「否」= 连同数据一起删除，无法恢复。" IDYES keepdata

  RMDir /r "$INSTDIR"
  Goto cleanup

  keepdata:
  Delete "$INSTDIR\*.exe"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.html"
  Delete "$INSTDIR\*.ico"
  Delete "$INSTDIR\*.txt"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\version"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\node_modules"
  Delete "$INSTDIR\uninstall.exe"

  cleanup:
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"
  SetRegView 64
  DeleteRegKey HKLM "${UNINST_KEY}"
SectionEnd

Function .onInit
  SetRegView 64
FunctionEnd
