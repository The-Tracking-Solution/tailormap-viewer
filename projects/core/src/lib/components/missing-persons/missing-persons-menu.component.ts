import { Component } from '@angular/core';
import { MenubarButtonComponent } from '../menubar/menubar-button/menubar-button.component';

@Component({
  selector: 'tm-missing-persons-menu',
  templateUrl: './missing-persons-menu.component.html',
  styleUrl: './missing-persons-menu.component.css',
  imports: [MenubarButtonComponent],
})
export class MissingPersonsMenuComponent {}
