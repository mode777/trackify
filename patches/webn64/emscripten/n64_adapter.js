/*
 n64_adapter.js: Adapts LazyUSF backend to generic WebAudio/ScriptProcessor player.

    version 1.1
 	copyright (C) 2018-2023 Juergen Wothke


 note: copy/paste of respective DS/GSF backends..

 note: LazyUSF emulator is SLOW. On my machine Chrome keeps complaining frequently
 that "audioprocess" took too long (e.g. 200ms - when it it should have been <20ms).

 LICENSE

 This library is free software; you can redistribute it and/or modify it
 under the terms of the GNU General Public License as published by
 the Free Software Foundation; either version 2.1 of the License, or (at
 your option) any later version. This library is distributed in the hope
 that it will be useful, but WITHOUT ANY WARRANTY; without even the
 implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See
 the GNU General Public License for more details.

 You should have received a copy of the GNU General Public
 License along with this library; if not, write to the Free Software
 Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301 USA
*/

/*
 * Local override of the upstream `submodules/webn64/emscripten/n64_adapter.js`.
 *
 * Drops the legacy `setProcessorBufSize(0x4000)` call. The
 * 0x4000-sample ScriptProcessor buffer was a hack to amortise the
 * slow N64 emulator across a single 16384-sample onaudioprocess
 * callback; the AudioWorklet pipeline runs the producer at the
 * 128-sample quantum and does not need the larger buffer.
 * See `docs/audio-worklet-migration.md` WP-H.
 */

class N64BackendAdapter extends EmsHEAP16BackendAdapter {
	constructor()
	{
		super(backend_N64.Module, 2, new SimpleFileMapper(backend_N64.Module));

		// removed: this.setProcessorBufSize(0x4000);

		this.ensureReadyNotification();
	}

	loadMusicData(sampleRate, path, filename, data, options)
	{
		filename = this._getFilename(path, filename);

		let ret = this.Module.ccall('emu_load_file', 'number',
							['string', 'number', 'number', 'number', 'number', 'number'],
							[ filename, 0, 0, ScriptNodePlayer.getWebAudioSampleRate(), -999, false]);

		if (ret == 0)
		{
			this._setupOutputResampling(sampleRate);
		}
		return ret;
	}

	evalTrackOptions(options)
	{
		super.evalTrackOptions(options);

		let boostVolume = (options && options.boostVolume) ? options.boostVolume : 0;
		this.Module.ccall('emu_set_boost', 'number', ['number'], [boostVolume]);

		// no subsongs in this format
		return 0;
	}

	getSongInfoMeta()
	{
		return {
			title: String,
			artist: String,
			game: String,
			year: String,
			genre: String,
			copyright: String,
			psfby: String
		};
	}

	updateSongInfo(filename)
	{
		let result = this._songInfo;

		let numAttr = 7;
		let ret = this.Module.ccall('emu_get_track_info', 'number');

		let array = this.Module.HEAP32.subarray(ret>>2, (ret>>2)+numAttr);
		result.title = this.Module.Pointer_stringify(array[0]);
		if (!result.title.length) result.title = this._makeTitleFromPath(filename);
		result.artist = this.Module.Pointer_stringify(array[1]);
		result.game = this.Module.Pointer_stringify(array[2]);
		result.year = this.Module.Pointer_stringify(array[3]);
		result.genre = this.Module.Pointer_stringify(array[4]);
		result.copyright = this.Module.Pointer_stringify(array[5]);
		result.psfby = this.Module.Pointer_stringify(array[6]);
	}
};
