package main

import (
	"embed"
	"io/fs"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend
var assets embed.FS

var version = "dev"

func main() {
	var root string
	if len(os.Args) >= 2 {
		abs, err := filepath.Abs(os.Args[1])
		if err != nil {
			log.Fatalf("invalid path: %v", err)
		}
		root = abs
	}

	app := NewApp(root)

	frontendAssets, err := fs.Sub(assets, "frontend")
	if err != nil {
		log.Fatal(err)
	}

	appMenu := menu.NewMenu()
	mb := appMenu.AddSubmenu(applicationTitle)
	mb.AddText("Quit "+applicationTitle, keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		runtime.Quit(app.ctx)
	})

	if err := wails.Run(&options.App{
		Title:  applicationTitle,
		Width:  initialWindowWidth,
		Height: initialWindowHeight,
		Menu:   appMenu,
		AssetServer: &assetserver.Options{
			Assets:  frontendAssets,
			Handler: app,
		},
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
		},
	}); err != nil {
		log.Fatal(err)
	}
}
