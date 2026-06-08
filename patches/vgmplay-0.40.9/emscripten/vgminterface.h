#ifndef _VGMPLAYINTERFACE_
#define _VGMPLAYINTERFACE_



typedef unsigned char UINT8; 
typedef signed char INT8; 
typedef unsigned short UINT16; 
typedef signed short INT16; 
typedef unsigned int UINT32; 
typedef signed int INT32;
typedef unsigned long UINT64; 
typedef signed long INT64;


extern "C" {
	
#include "stdbool.h"
#include "VGMPlay.h"
#include "VGMPlay_Intf.h"

extern void VGMPlay_Init(void);
extern void VGMPlay_Init2(void);
extern void VGMPlay_Deinit(void);
extern bool OpenVGMFile(const char* FileName);
extern void CloseVGMFile(void);

extern void PlayVGM(void);
extern void StopVGM(void);
extern UINT32 FillBuffer(WAVE_16BS* Buffer, UINT32 BufferSize);

extern void PlayVGM_Emscripten(void);
extern void StopVGM_Emscripten(void);
extern bool IsEndPlay_Emscripten(void);
extern UINT32 FillBuffer_Emscripten(WAVE_16BS* Buffer, UINT32 BufferSize);

extern GD3_TAG VGMTag;
extern UINT32 SampleRate;
extern bool EndPlay;
extern UINT8 FileMode;
extern UINT8 BoostVolume;
extern VGM_HEADER VGMHead;
extern INT32 VGMSmplPlayed;
extern UINT32 VGMPos;
extern UINT32 VGMMaxLoopM;
extern UINT32 VGMCurLoop;
extern UINT32 PlayingTime;
extern INT32 VGMSampleRate;

extern void SeekVGM(bool Relative, INT32 PlayBkSamples);
extern INT32 SampleVGM2Playback(INT32 SampleVal);
extern UINT32 CalcSampleMSec(UINT64 Value, UINT8 Mode);
extern UINT32 CalcSampleMSecExt(UINT64 Value, UINT8 Mode, VGM_HEADER* FileHead);

extern UINT32 FadeTime;
extern UINT32 PauseTime;


// reuse utils from original UI
extern void ReadOptions(const char* filename);
extern const wchar_t* GetTagStrEJ(const wchar_t* EngTag, const wchar_t* JapTag);
extern const char * GetChipsInfo(void);

};


#endif