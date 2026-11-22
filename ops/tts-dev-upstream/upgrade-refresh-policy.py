#!/usr/bin/env python3
"""Upgrade only the known installed refresh helper, preserving its private original."""
import hashlib
import os
from pathlib import Path
import tempfile

OLD_SHA='34a8767de57e78122424ac474f8acdb6f6dfa7954d3ec32d0402082eae8eca3a'
INSTALLED_SHA='fc31f9950f5d21df8f21ebcbfb00fe943a1e783811e2a3726ae05e9670164fbb'
NEW_SHA='24d48c0cf484ca83412137e9927cb3d76bebe73eb96859ec0cc38865e7978848'
SCRIPT_SHA='907414f520ab0b71f31d7c053cf433c7f4b4cab1706f2ad0e69e7f775c10aa77'
GEODATA_SHA='b65a6a281f201b3c91d0fea86718ea5ce5401b0e3183eba723292f4a8afb230a'
DIRECTORY=Path('/srv/tailormap/scripts')


def require(ok,msg):
    if not ok:raise ValueError(msg)


def sha(data):return hashlib.sha256(data).hexdigest()


OLD_LOOP="        for path, value in paths(old.get('components'), 'showEmbeddedVideos'):\n            if value != optional(new.get('components'), path, False):\n                wanted.append(('components', path, value))"
OLD_GUARD="            else:\n                # Array indices are accepted only when the enclosing component keeps\n                # the same identity/type, so a reordered component cannot be overwritten.\n                try:\n                    before_parent = get(old[column], path[:-1])\n                    after_parent = get(new[column], path[:-1])\n                    require(isinstance(after_parent, dict), 'Ongeldige feature-info-configuratie.')\n                    for length in range(len(path)):\n                        left = get(old[column], path[:length])\n                        right = get(new[column], path[:length])\n                        if isinstance(left, dict):\n                            keys = ('id', 'type', 'name', 'objectType')\n                            require(isinstance(right, dict) and\n                                {k:v for k,v in left.items() if k in keys} ==\n                                {k:v for k,v in right.items() if k in keys},\n                                'Feature-info-component niet eenduidig te koppelen.')\n                except (KeyError, IndexError, TypeError, ValueError):\n                    raise RuntimeError('Feature-info-component ontbreekt in replica; refresh gestopt vóór vervanging.')\n"
OLD_APPLY='        statements.append(f"UPDATE public.{table} SET {column}=jsonb_set({column},"'
NEW_APPLY='        root = f"coalesce({column},\'[]\'::jsonb)" if column == \'components\' else column\n        statements.append(f"UPDATE public.{table} SET {column}=jsonb_set({root},"'
VERIFY_ANCHOR='            f"ARRAY(SELECT jsonb_array_elements_text({literal(path)})),{literal(item[\'value\'])},true) WHERE id={item[\'id\']};")\n'
VERIFY_SQL='        statements.append(f"DO $verify$ BEGIN IF (SELECT {column} #> "\n            f"ARRAY(SELECT jsonb_array_elements_text({literal(path)})) FROM public.{table} "\n            f"WHERE id={item[\'id\']}) IS DISTINCT FROM {literal(item[\'value\'])} "\n            "THEN RAISE EXCEPTION \'Refresh-overlay niet toegepast\'; END IF; END $verify$;")\n'

def normalize_video_fix(text):
    if 'def component_video_plan(' in text:
        return text
    changes = [
        ('def plan(source, target):', Path(__file__).with_name('refresh-video-extension.py').read_text()+'def plan(source, target):'),
        (OLD_LOOP, '        updates.extend(component_video_plan(old, new))'),
        (OLD_GUARD, ''),
        (OLD_APPLY, NEW_APPLY),
        (VERIFY_ANCHOR, VERIFY_ANCHOR+VERIFY_SQL),
    ]
    for before,after in changes:
        require(text.count(before)==1,'Refresh-video-bron wijkt af bij een patchpunt')
        text=text.replace(before,after,1)
    return text


def transform(text):
    text=normalize_video_fix(text)
    extension=Path(__file__).with_name('refresh-policy-extension.py').read_text()
    changes=[
      ('Only preserve three known video/refresh paths, never user preferences.', 'Preserve bounded video, refresh, alerts and replica ports; source preferences win.'),
      ('Begrensde video-/refreshoverlay:', 'Begrensde lokale overlay:'),
      ("'feature_sources',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'protocol',protocol,'title',title)), '[]') FROM public.feature_source)",
       "'feature_sources',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'protocol',protocol,'title',title,'host',jdbc_connection->>'host','port',jdbc_connection->'port','database',jdbc_connection->>'database','schema',jdbc_connection->>'schema')), '[]') FROM public.feature_source)"),
      ('def plan(source, target):',extension+'\n\ndef plan(source, target):'),
      ("        updates.extend(component_video_plan(old, new))", "        updates.extend(component_updates(new,old))"),
      ('    return updates\n', '    updates.extend(replica_port_updates(source,target))\n    return updates\n'),
      ("source_sources[origin] == target_sources.get(origin)", "all(source_sources[origin].get(k)==(target_sources.get(origin) or {}).get(k) for k in ('id','protocol','title'))"),
      ("item['table'] in ('application', 'feature_type') and\n                item['column'] in ('settings','components')", "((item['table']=='application' and item['column'] in ('settings','components')) or\n                 (item['table']=='feature_type' and item['column']=='settings') or\n                 (item['table']=='feature_source' and item['column']=='jdbc_connection' and item['path']==['port'] and str(item['value'])=='5433'))"),
      ('        path = item[\'path\']\n', "        path = item['path']\n        if column=='components':\n            statements.append(f\"UPDATE public.{table} SET components=coalesce(components,'[]'::jsonb) WHERE id={item['id']};\")\n")
    ]
    for before,after in changes:
        require(text.count(before)==1,'Refresh-bron wijkt af bij een patchpunt')
        text=text.replace(before,after,1)
    compile(text,'refresh-policy.py','exec')
    return text


def atomic_write(path,data,mode):
    fd,name=tempfile.mkstemp(prefix='.upstream-policy-',dir=path.parent)
    temp=Path(name)
    try:
        with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
        temp.chmod(mode);os.replace(temp,path)
    finally:temp.unlink(missing_ok=True)


def install(backup):
    for name,expected in [('refresh-lt3-data.sh',SCRIPT_SHA),('refresh-geodata.py',GEODATA_SHA)]:
        require((DIRECTORY/name).is_file() and sha((DIRECTORY/name).read_bytes())==expected,'Onbekende geïnstalleerde refreshversie: '+name)
    path=DIRECTORY/'refresh-policy.py';require(path.is_file() and not path.is_symlink(),'Onverwachte refresh-helper')
    current=path.read_bytes()
    if sha(current)==NEW_SHA:return 'ALREADY_CURRENT'
    require(sha(current) in (OLD_SHA,INSTALLED_SHA),'Geïnstalleerde refresh-policy is gewijzigd; niet overschreven')
    updated=transform(current.decode()).encode();require(sha(updated)==NEW_SHA,'Nieuwe refresh-policy checksum wijkt af')
    backup.mkdir(parents=True,exist_ok=True)
    (backup/'refresh-policy.before').write_bytes(current)
    atomic_write(path,updated,path.stat().st_mode & 0o777)
    return 'UPDATED'
