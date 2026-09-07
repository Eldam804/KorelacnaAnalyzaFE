import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddFilesComponent } from './add-files.component';

describe('AddFilesComponent', () => {
  let component: AddFilesComponent;
  let fixture: ComponentFixture<AddFilesComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [AddFilesComponent]
    });
    fixture = TestBed.createComponent(AddFilesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
