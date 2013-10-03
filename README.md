jQuery pageleave
================

A small plugin for users wanting to leave your page (based on jQuery).

### Basic idea
While jquery/javascript already have events for users leaving your page (unload, beforeunload), they all have theirs pros and cons.
The basic idea behind this small plugin is that a user wanting to leave your page will sooner or later type sth. (probably a url) in 
the location bar which usually resides on top of the content.
This is where this plugin fires and where you could show a modal box asking for feedback, informing them that some content hasn't been
saved properly and that you are sick at heart they are leaving...


### What it does
Firing an event (after some initial delay) when the user move the mouse to the location bar. This could be used to show a modal box or sth. else.

### What it does not
The plugin does not prevent the user from leaving, so please do not rely on it when you have unsaved changes to your database, to the profile 
or to some docs they have been working on! Additionally, some users move the mouse extremely fast so that the mousemove-handler might not even be aware of the 
user having scrolled over a specific area. You should really, really only use it for non-essential tasks!

### Demo
See a working demo at [www.rexmedicus.com/jquerypageleave][1].

### Installation
1. Download it.
2. Load it in your js file
3. Bind it to an appropriate container:

```js
	$(document).on('pageleave', function() {
      	alert("Oh no! Please don't leave me!");
      	// do sth. else
    });
    $.fn.pageleave();
```

### Configuration
Please see the different configuration options at [www.rexmedicus.com/jquerypageleave][1].

### Where to go from here
If you encounter any errors or want to add functionality, please do not hesitate to open a [Pull Request][2]

[1]: http://www.rexmedicus.com/jquerypageleave
[2]: http://github.com/github/markup/pulls