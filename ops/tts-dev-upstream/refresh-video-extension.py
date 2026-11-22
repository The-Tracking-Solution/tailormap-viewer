def component_video_plan(old, new):
    """Map the video switch by component type, never by a stale array index."""
    local = old.get('components')
    live = new.get('components')
    local = [] if local is None else local
    live = [] if live is None else live
    require(isinstance(local, list) and isinstance(live, list),
            'Onverwachte componentstructuur: '+old['name'])
    switches = list(paths(local, 'showEmbeddedVideos'))
    if not switches:
        return []
    local_matches = [i for i, c in enumerate(local)
                     if isinstance(c, dict) and c.get('type') == 'FEATURE_INFO']
    live_matches = [i for i, c in enumerate(live)
                    if isinstance(c, dict) and c.get('type') == 'FEATURE_INFO']
    require(len(local_matches) == 1 and len(live_matches) <= 1 and len(switches) == 1,
            'Feature-info-component niet eenduidig te koppelen: '+old['name'])
    path, value = switches[0]
    require(path == (str(local_matches[0]), 'config', 'showEmbeddedVideos')
            and isinstance(value, bool), 'Onverwachte video-instelling: '+old['name'])
    if not live_matches:
        if value is False:
            return []  # Missing component already has the disabled video default.
        # Add only the minimum configuration for the local video feature. Other
        # local component flags (edit button, dropdown, etc.) are not imported.
        path = (str(len(live)),)
        value = {'type':'FEATURE_INFO', 'config':{'enabled':True, 'showEmbeddedVideos':value}}
    else:
        index = str(live_matches[0])
        config = live[live_matches[0]].get('config')
        require(config is None or isinstance(config, dict),
                'Ongeldige feature-info-configuratie: '+old['name'])
        if value == (config or {}).get('showEmbeddedVideos', False):
            return []
        if config is None:
            path, value = (index, 'config'), {'showEmbeddedVideos':value}
        else:
            path = (index, 'config', 'showEmbeddedVideos')
    return [{'table':'application', 'id':new['id'], 'column':'components',
             'path':list(path), 'value':value}]


