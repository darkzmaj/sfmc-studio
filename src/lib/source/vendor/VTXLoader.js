// Vendored from https://github.com/gkjohnson/source-engine-model-loader (MIT, (c) Garrett Johnson). See THIRD_PARTY_NOTICES.md.
// @ts-nocheck
import {
	DefaultLoadingManager,
	FileLoader
} from 'three';

// VTX: https://developer.valvesoftware.com/wiki/VTX

// SFMC: StripGroupHeader_t/StripHeader_t are 25/27 bytes in older (TF2/SFM) VTX files and 33/35 in newer ones.
// The layout is chosen by parseVtx() below by validating the parsed result.
export const VTX_LAYOUT = { group: 25, strip: 27 };

const VTXLoader = function ( manager ) {

	this.manager = ( manager !== undefined ) ? manager : DefaultLoadingManager;

};

VTXLoader.prototype = {

	constructor: VTXLoader,

	load: function ( url, onLoad, onProgress, onError ) {

		const scope = this;

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.load( url, function ( text ) {

			onLoad( scope.parse( text ) );

		}, onProgress, onError );

	},

	parse: function ( buffer ) {

		function readString( dataView, offset, count = Infinity ) {

			let str = '';
			for ( let j = 0; j < count; j ++ ) {

				const c = dataView.getUint8( j + offset );
				if ( c === 0 ) break;

				str += String.fromCharCode( c );

			}

			return str;

		}

		// struct FileHeader_t
		function parseHeader( buffer ) {

			const dataView = new DataView( buffer );
			let i = 0;

			// int
			const version = dataView.getInt32( i, true );
			i += 4;

			// int
			const vertCacheSize = dataView.getInt32( i, true );
			i += 4;

			// short
			const maxBonesPerStrip = dataView.getUint16( i, true );
			i += 2;

			// short
			const maxBonesPerTri = dataView.getUint16( i, true );
			i += 2;

			// int
			const maxBonesPerVert = dataView.getInt32( i, true );
			i += 4;

			// int
			const checksum = dataView.getInt32( i, true );
			i += 4;

			// int
			const numLODs = dataView.getInt32( i, true );
			i += 4;

			// int
			const materialReplacementListOffset = dataView.getInt32( i, true );
			i += 4;

			// int
			const numBodyParts = dataView.getInt32( i, true );
			i += 4;

			// int
			const bodyPartOffset = dataView.getInt32( i, true );
			i += 4;

			return {
				version,
				vertCacheSize,
				maxBonesPerStrip,
				maxBonesPerTri,
				maxBonesPerVert,
				checksum,
				numLODs,
				materialReplacementListOffset,
				numBodyParts,
				bodyPartOffset
			};


		}

		// struct StripHeader_t
		function parseStrips( buffer, numStrips, stripOffset ) {

			const dataView = new DataView( buffer );
			const res = [];

			for ( let i = 0; i < numStrips; i ++ ) {

				// TODO: This offset seems to make things work correctly for the ball and chain
				// but it's unclear why... padding?
				// var offset = stripOffset + i * 27;
				const offset = stripOffset + i * VTX_LAYOUT.strip;
				const strip = {};
				strip.numIndices = dataView.getInt32( offset + 0, true );
				strip.indexOffset = dataView.getInt32( offset + 4, true );

				strip.numVerts = dataView.getInt32( offset + 8, true );
				strip.vertOffset = dataView.getInt32( offset + 12, true );

				strip.numBones = dataView.getInt16( offset + 16, true );

				strip.flags = dataView.getUint8( offset + 18, true );

				// TODO: parse these into an array
				strip.numBoneStateChanges = dataView.getInt32( offset + 19, true );
				strip.boneStateChangeOffset = dataView.getInt32( offset + 23, true );


				res.push( strip );

			}

			return res;

		}

		// struct StripGroupHeader_t
		function parseStripGroups( buffer, numStripGroups, stripGroupHeaderOffset ) {

			const dataView = new DataView( buffer );
			const res = [];
			for ( let i = 0; i < numStripGroups; i ++ ) {

				// TODO: Looking at the padding offsets in the MGSBox model it looks like
				// this struct has as stride of 33 but counting up yields 25?
				// var offset = stripGroupHeaderOffset + i * 25;
				const offset = stripGroupHeaderOffset + i * VTX_LAYOUT.group;
				const stripGroup = {};
				stripGroup.numVerts = dataView.getInt32( offset + 0, true );
				stripGroup.vertOffset = dataView.getInt32( offset + 4, true );

				stripGroup.numIndices = dataView.getInt32( offset + 8, true );
				stripGroup.indexOffset = dataView.getInt32( offset + 12, true );

				stripGroup.numStrips = dataView.getInt32( offset + 16, true );
				stripGroup.stripOffset = dataView.getInt32( offset + 20, true );

				stripGroup.flags = dataView.getUint8( offset + 24, true );

				stripGroup.strips = parseStrips( buffer, stripGroup.numStrips, offset + stripGroup.stripOffset );

				stripGroup.indexDataStart = offset + stripGroup.indexOffset;
				stripGroup.vertexDataStart = offset + stripGroup.vertOffset;

				res.push( stripGroup );

			}

			return res;

		}

		// struct MeshHeader_t
		function parseMeshes( buffer, numMeshes, meshOffset ) {

			const dataView = new DataView( buffer );
			const res = [];
			for ( let i = 0; i < numMeshes; i ++ ) {

				const offset = meshOffset + i * 9;
				const mesh = {};
				mesh.numStripGroups = dataView.getInt32( offset + 0, true );
				mesh.stripGroupHeaderOffset = dataView.getInt32( offset + 4, true );
				mesh.flags = dataView.getUint8( offset + 8, true );
				mesh.stripGroups = parseStripGroups( buffer, mesh.numStripGroups, offset + mesh.stripGroupHeaderOffset );
				res.push( mesh );

			}

			return res;

		}

		// struct ModelLODHeader_t
		function parseLods( buffer, numLODs, lodOffset ) {

			const dataView = new DataView( buffer );
			const res = [];
			for ( let i = 0; i < numLODs; i ++ ) {

				const offset = lodOffset + i * 12;
				const lod = {};
				lod.numMeshes = dataView.getInt32( offset + 0, true );
				lod.meshOffset = dataView.getInt32( offset + 4, true );
				lod.switchPoint = dataView.getFloat32( offset + 8, true );
				lod.meshes = parseMeshes( buffer, lod.numMeshes, offset + lod.meshOffset );

				res.push( lod );

			}

			return res;

		}

		// struct ModelHeader_t
		function parseModels( buffer, numModels, modelOffset ) {

			const dataView = new DataView( buffer );
			const res = [];
			for ( let i = 0; i < numModels; i ++ ) {

				const offset = modelOffset + i * 8;
				const model = {};
				model.numLODs = dataView.getInt32( offset + 0, true );
				model.lodOffset = dataView.getInt32( offset + 4, true );
				model.lods = parseLods( buffer, model.numLODs, offset + model.lodOffset );

				res.push( model );

			}

			return res;

		}

		// struct BodyPartHeader_t
		function parseBodyParts( buffer, numBodyParts, bodyPartOffset ) {

			const dataView = new DataView( buffer );
			const res = [];
			for ( let i = 0; i < numBodyParts; i ++ ) {

				const offset = bodyPartOffset + i * 8;
				const bodyPart = {};
				bodyPart.numModels = dataView.getInt32( offset + 0, true );
				bodyPart.modelOffset = dataView.getInt32( offset + 4, true );
				bodyPart.models = parseModels( buffer, bodyPart.numModels, offset + bodyPart.modelOffset );

				res.push( bodyPart );

			}

			return res;

		}

		function parseMaterialReplacement( buffer, matReplacementNum, matReplacementOffset ) {

			const dataView = new DataView( buffer );
			const res = [];
			for ( let i = 0; i < matReplacementNum; i ++ ) {

				const offset = matReplacementOffset + i * 8;
				const replaceMaterial = {};
				replaceMaterial.numReplacements = dataView.getInt32( offset + 0, true );
				replaceMaterial.replacementOffset = dataView.getInt32( offset + 4, true );
				replaceMaterial.replacements = [];

				for ( let j = 0; j < replaceMaterial.numReplacements; j ++ ) {

					const offset2 = replaceMaterial.replacementOffset + i * 6;
					const replacement = {};
					replacement.materialID = dataView.getInt16( offset2 + 0, true );
					replacement.name = readString( dataView, dataView.getInt32( offset2 + 2, true ) );

				}

				res.push( replaceMaterial );

			}

			return res;

		}

		const header = parseHeader( buffer );
		const bodyParts = parseBodyParts( buffer, header.numBodyParts, header.bodyPartOffset );
		const materialReplacements = parseMaterialReplacement( buffer, header.numLODs, header.materialReplacementListOffset );

		return { header, bodyParts, materialReplacements, buffer };

	}

};

export { VTXLoader };

// SFMC addition: parse with whichever struct layout yields a self-consistent result.
export function parseVtx( buffer ) {

	let lastError = null;
	for ( const layout of [ { group: 25, strip: 27 }, { group: 33, strip: 35 } ] ) {

		VTX_LAYOUT.group = layout.group;
		VTX_LAYOUT.strip = layout.strip;
		try {

			const vtx = new VTXLoader().parse( buffer );
			let ok = true;
			for ( const bp of vtx.bodyParts ) for ( const m of bp.models ) for ( const lod of m.lods ) for ( const mesh of lod.meshes ) for ( const sg of mesh.stripGroups ) {

				if ( sg.numStrips < 0 || sg.numStrips > 100000 || sg.indexDataStart + sg.numIndices * 2 > buffer.byteLength ) ok = false;
				for ( const s of sg.strips ) if ( s.indexOffset < 0 || s.numIndices < 0 || s.indexOffset + s.numIndices > sg.numIndices ) ok = false;

			}

			if ( ok ) return vtx;

		} catch ( e ) {

			lastError = e;

		}

	}

	throw lastError || new Error( 'VTX layout could not be determined' );

}
