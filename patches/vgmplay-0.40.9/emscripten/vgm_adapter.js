/*
 vgm_adapter.js: Adapts vgmPlay backend to generic WebAudio/ScriptProcessor player.

 version 1.1

 	Copyright (C) 2015-2023 Juergen Wothke




 LICENSE

 This library is free software; you can redistribute it and/or modify it
 under the terms of the GNU General Public License as published by
 the Free Software Foundation; either version 2.1 of the License, or (at
 your option) any later version. This library is distributed in the hope
 that it will be useful, but WITHOUT ANY WARRANTY; without even the implied
 warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public
 License along with this library; if not, write to the Free Software
 Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301 USA
*/

class VgmFileMapper extends SimpleFileMapper {
	constructor(module, resourcePath)
	{
		super(module);
		this.resourcePath = resourcePath ?? "";
	}

	mapCacheFileName(name)
	{
		// make sure the shortcut preload is cached where it will be searched
		if (this.isResource(name)) name = this.resourcePath + name;
		return name;
	}

	mapUrl(filename)
	{
		// PlayMOD hack: allow relative names in preload list
		if (this.isResource(filename)) filename = this.resourcePath + filename;
		return super.mapUrl(filename);
	}

	registerFileData(pathFilenameArray, data)
	{
		// PlayMOD hack: allow relative names in preload list
		if (this.isResource(pathFilenameArray[1])) pathFilenameArray[0] = this.resourcePath.slice(0, -1);

		return super.registerFileData(pathFilenameArray, data);
	}

	isResource(name)
	{
		return (name == "VGMPlay.ini") || (name == "yrw801.rom");
	}
};


class VgmBackendAdapter extends EmsHEAP16BackendAdapter {
	constructor(resourcePath)
	{
		super(backend_vgmPlay.Module, 2, new VgmFileMapper(backend_vgmPlay.Module, resourcePath));

		this.resourcePath = resourcePath ?? "";

		this.ensureReadyNotification();
	}

	loadMusicData(sampleRate, path, filename, data)
	{
		filename = this._getFilename(path, filename);

		this.Module.ccall('emu_set_resource_path', 'number', ['string'], [this.resourcePath]);

		let ret = this.Module.ccall('emu_load_file', 'number',
							['string', 'number', 'number', 'number', 'number', 'number'],
							[ filename, 0, 0, ScriptNodePlayer.getWebAudioSampleRate(), 1024, false]);

		if (ret == 0)
		{
			this._setupOutputResampling(sampleRate);
		}
		return ret;
	}

	evalTrackOptions(options)
	{
		super.evalTrackOptions(options);

		let boostVolume= (options && options.boostVolume) ? options.boostVolume : 0;
		this.Module.ccall('emu_set_boost', 'number', ['number'], [boostVolume]);

		let id= (options && options.track) ? options.track : 0;
		return this.Module.ccall('emu_set_subsong', 'number', ['number'], [id]);
	}

	getSongInfoMeta()
	{
		return {
			title: String,
			author: String,
			desc: String,
			notes: String,
			program: String,	// deprecated use "system"
			system: String,
			chips: String,
			tracks: Number,
			currentTrack: Number
		};
	}

	unicodeToString(ptr)
	{
		ptr = ptr >> 2;	//32-bit
		let str = '';
		for (let i= 0; i< 255*4; i++) {	// use a limit just in case
			let ch = this.Module.HEAP32[ptr++];
			if (!ch)
			{
				return str;
			}
			str += String.fromCharCode(ch);
		}
	}

	updateSongInfo(filename) {
		let result = this._songInfo;
		let numAttr = 6;
		let ret = this.Module.ccall('emu_get_track_info', 'number');

		let array = this.Module.HEAP32.subarray(ret>>2, (ret>>2)+numAttr);
		result.title = this.unicodeToString(array[0]);
		if (!result.title.length) result.title = this._makeTitleFromPath(filename);

		result.author = this.unicodeToString(array[1]);
		result.desc = this.unicodeToString(array[2]);
		result.notes = this.unicodeToString(array[3]);
		result.system = this.unicodeToString(array[4]);
		result.program = result.system;	// deprecated
		result.chips = this.Module.Pointer_stringify(array[5]);
		let t = this.Module.Pointer_stringify(array[6]);
		result.tracks = parseInt(t);
		result.currentTrack = 0;
	}
};

